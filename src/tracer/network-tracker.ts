import type { CDPSession } from 'puppeteer-core'
import type { SessionStorage } from '../storage'
import type {
  NetworkFinishedEvent,
  NetworkRequestEvent,
  NetworkResponseEvent,
} from '../types'

/** Date が表現できる Unix 時刻の最大値 (秒) */
const MAX_EPOCH_SECONDS = 8.64e12

/**
 * CDP セッションごとの時刻換算状態。
 * setup() の呼び出しごとに 1 つ作られ、そのオブジェクトの同一性をセッションの識別子として使う。
 */
interface SessionClock {
  /** 直近に取得できた wallTime - timestamp (秒)。未取得の間は null */
  latestOffset: number | null
  /** 基準を取得できなかった旨の警告を出力済みか */
  warned: boolean
}

/** リングバッファ管理用の保留中リクエスト情報 */
interface PendingRequest {
  url: string
  documentUrl: string
  /** このリクエスト自身の requestWillBeSent から求めた wallTime - timestamp (秒)。求められなかった場合は null */
  clockOffset: number | null
  /** このエントリを登録した setup() の SessionClock */
  owner: SessionClock
}

/**
 * ユニークなイベント ID を生成する。
 * タイムスタンプとランダム文字列を組み合わせる。
 */
function generateEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Unix 時刻 (秒) をミリ秒に丸めた ISO 8601 文字列に変換する。
 * Date で表現できない値 (非有限値を含む) の場合は null を返す。
 * @param seconds - Unix 時刻 (秒)
 */
function isoFromEpochSeconds(seconds: number): string | null {
  const date = new Date(Math.round(seconds * 1000))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * CDP の MonotonicTime (timestamp) を Unix 時刻へ換算するためのオフセット (秒) を求める。
 * 換算に使えない値の場合は null を返す。
 * @param timestamp - CDP の MonotonicTime (秒)
 * @param wallTime - 同じ時点の Unix 時刻 (秒)
 */
function clockOffsetFromCdp(
  timestamp: number,
  wallTime: number
): number | null {
  const offset = wallTime - timestamp
  return Number.isFinite(offset) &&
    Math.abs(offset) <= MAX_EPOCH_SECONDS &&
    isoFromEpochSeconds(wallTime) !== null
    ? offset
    : null
}

/**
 * Chrome CDP Network ドメインを使用してネットワーク通信を追跡するクラス。
 *
 * 追跡対象イベント:
 * - Network.requestWillBeSent (リクエスト送信)
 * - Network.responseReceived (レスポンス受信)
 * - Network.loadingFinished (ロード完了)
 * - Network.loadingFailed (ロード失敗)
 *
 * ネットワークイベントは、発生時点の現在操作ディレクトリ (getCurrentOpDir) に
 * network.jsonl として書き込まれる。操作ディレクトリが未設定の場合は破棄する。
 *
 * CDP の timestamp は単調増加時計 (MonotonicTime) の値であり、Unix 時刻ではない。
 * requestWillBeSent の wallTime との差 (オフセット) で Unix 時刻へ換算して記録する。
 *
 * 内部でリングバッファを使用して、未完了リクエストのメモリ使用量を制限する。
 */
export class NetworkTracker {
  private readonly storage: SessionStorage
  private readonly bufferSize: number
  private readonly getCurrentOpDir: () => string | null
  private readonly pendingRequests = new Map<string, PendingRequest>()

  /**
   * @param storage - セッションストレージ
   * @param bufferSize - リングバッファの最大サイズ
   * @param getCurrentOpDir - 現在の操作ディレクトリパスを返す関数。未設定時は null
   */
  constructor(
    storage: SessionStorage,
    bufferSize: number,
    getCurrentOpDir: () => string | null
  ) {
    this.storage = storage
    this.bufferSize = bufferSize
    this.getCurrentOpDir = getCurrentOpDir
  }

  /**
   * CDP セッションにネットワーク追跡リスナーを登録する。
   * Network.enable を送信してドメインを有効化する。
   * @param cdpSession - 対象の CDPSession
   */
  async setup(cdpSession: CDPSession): Promise<void> {
    await cdpSession.send('Network.enable', {
      maxPostDataSize: 65_536,
    })

    const clock: SessionClock = { latestOffset: null, warned: false }

    const resolveTimestamp = (
      timestamp: number,
      offset: number | null
    ): string => {
      const iso =
        offset === null ? null : isoFromEpochSeconds(timestamp + offset)
      if (iso !== null) {
        return iso
      }

      // Network.enable 前から進行中のリクエストなどは換算の基準がないため、受信時刻で代替する
      if (!clock.warned) {
        clock.warned = true
        console.warn(
          '[NetworkTracker] CDP の時刻基準 (wallTime) が未取得または不正なため、受信時刻で代替します'
        )
      }
      return new Date().toISOString()
    }

    const offsetFor = (pending: PendingRequest | undefined): number | null =>
      (pending?.owner === clock ? pending.clockOffset : null) ??
      clock.latestOffset

    // リクエスト送信時
    cdpSession.on('Network.requestWillBeSent', (event) => {
      const offset = clockOffsetFromCdp(event.timestamp, event.wallTime)
      if (offset !== null) {
        clock.latestOffset = offset
      }

      this.evictIfFull()
      this.pendingRequests.set(event.requestId, {
        url: event.request.url,
        documentUrl: event.documentURL,
        clockOffset: offset,
        owner: clock,
      })

      const tracerEvent: NetworkRequestEvent = {
        eventId: generateEventId(),
        sessionId: this.storage.sessionId,
        frameUrl: event.documentURL,
        timestamp: resolveTimestamp(event.timestamp, clock.latestOffset),
        type: 'network_request',
        requestId: event.requestId,
        url: event.request.url,
        method: event.request.method,
        headers: event.request.headers,
        // postDataEntries (base64) への移行は記録フォーマット互換性に影響するため見送り、非推奨警告のみ抑止する
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        postData: event.request.postData,
      }

      this.appendToCurrentOp(tracerEvent)
    })

    // レスポンス受信時
    cdpSession.on('Network.responseReceived', (event) => {
      const pending = this.pendingRequests.get(event.requestId)
      const tracerEvent: NetworkResponseEvent = {
        eventId: generateEventId(),
        sessionId: this.storage.sessionId,
        frameUrl: pending?.documentUrl ?? '',
        timestamp: resolveTimestamp(event.timestamp, offsetFor(pending)),
        type: 'network_response',
        requestId: event.requestId,
        url: event.response.url,
        status: event.response.status,
        mimeType: event.response.mimeType,
        headers: event.response.headers,
      }

      this.appendToCurrentOp(tracerEvent)
    })

    // ロード完了時
    cdpSession.on('Network.loadingFinished', (event) => {
      const pending = this.pendingRequests.get(event.requestId)
      this.pendingRequests.delete(event.requestId)

      const tracerEvent: NetworkFinishedEvent = {
        eventId: generateEventId(),
        sessionId: this.storage.sessionId,
        frameUrl: pending?.documentUrl ?? '',
        timestamp: resolveTimestamp(event.timestamp, offsetFor(pending)),
        type: 'network_finished',
        requestId: event.requestId,
        url: pending?.url ?? '',
        encodedDataLength: event.encodedDataLength,
      }

      this.appendToCurrentOp(tracerEvent)
    })

    // ロード失敗時 (タイムアウト・DNS 解決失敗など)
    // pendingRequests から削除してリングバッファのスロットを解放する
    cdpSession.on('Network.loadingFailed', (event) => {
      this.pendingRequests.delete(event.requestId)
    })
  }

  /**
   * ネットワークイベントを現在の操作ディレクトリに追記する。
   * 操作ディレクトリが未設定の場合は破棄する。
   */
  private appendToCurrentOp(
    event: NetworkRequestEvent | NetworkResponseEvent | NetworkFinishedEvent
  ): void {
    const opDir = this.getCurrentOpDir()
    if (!opDir) return
    this.storage.appendOpNetwork(opDir, event).catch((error: unknown) => {
      console.error('[NetworkTracker] ネットワークイベント保存エラー:', error)
    })
  }

  /**
   * バッファが上限に達している場合、最古のエントリを削除する (リングバッファ)。
   */
  private evictIfFull(): void {
    if (this.pendingRequests.size < this.bufferSize) {
      return
    }

    const firstKey = this.pendingRequests.keys().next().value
    if (firstKey !== undefined) {
      this.pendingRequests.delete(firstKey)
    }
  }
}
