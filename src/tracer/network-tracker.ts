import type { CDPSession } from 'puppeteer-core'
import type { SessionStorage } from '../storage'
import type {
  NetworkFinishedEvent,
  NetworkRequestEvent,
  NetworkResponseEvent,
} from '../types'

/** リングバッファ管理用の保留中リクエスト情報 */
interface PendingRequest {
  url: string
  frameId: string
}

/**
 * ユニークなイベント ID を生成する。
 * タイムスタンプとランダム文字列を組み合わせる。
 */
function generateEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * CDP のタイムスタンプ (Unix 秒) を ISO 8601 文字列に変換する。
 * @param cdpTimestamp - CDP から受け取った秒単位のタイムスタンプ
 */
function isoFromCdpTimestamp(cdpTimestamp: number): string {
  return new Date(cdpTimestamp * 1000).toISOString()
}

/**
 * Chrome CDP Network ドメインを使用してネットワーク通信を追跡するクラス。
 *
 * 追跡対象イベント:
 * - Network.requestWillBeSent (リクエスト送信)
 * - Network.responseReceived (レスポンス受信)
 * - Network.loadingFinished (ロード完了)
 *
 * ネットワークイベントは、発生時点の現在操作ディレクトリ (getCurrentOpDir) に
 * network.jsonl として書き込まれる。操作ディレクトリが未設定の場合は破棄する。
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

    // リクエスト送信時
    cdpSession.on('Network.requestWillBeSent', (event) => {
      this.evictIfFull()
      this.pendingRequests.set(event.requestId, {
        url: event.request.url,
        frameId: event.frameId ?? '',
      })

      const tracerEvent: NetworkRequestEvent = {
        eventId: generateEventId(),
        sessionId: this.storage.sessionId,
        frameUrl: event.frameId ?? '',
        timestamp: isoFromCdpTimestamp(event.timestamp),
        type: 'network_request',
        requestId: event.requestId,
        url: event.request.url,
        method: event.request.method,
        headers: event.request.headers as Record<string, string>,
        postData: event.request.postData,
      }

      this.appendToCurrentOp(tracerEvent)
    })

    // レスポンス受信時
    cdpSession.on('Network.responseReceived', (event) => {
      const tracerEvent: NetworkResponseEvent = {
        eventId: generateEventId(),
        sessionId: this.storage.sessionId,
        frameUrl: event.frameId ?? '',
        timestamp: isoFromCdpTimestamp(event.timestamp),
        type: 'network_response',
        requestId: event.requestId,
        url: event.response.url,
        status: event.response.status,
        mimeType: event.response.mimeType,
        headers: event.response.headers as Record<string, string>,
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
        frameUrl: pending?.frameId ?? '',
        timestamp: isoFromCdpTimestamp(event.timestamp),
        type: 'network_finished',
        requestId: event.requestId,
        url: pending?.url ?? '',
        encodedDataLength: event.encodedDataLength,
      }

      this.appendToCurrentOp(tracerEvent)
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
    if (this.pendingRequests.size >= this.bufferSize) {
      const firstKey = this.pendingRequests.keys().next().value
      if (firstKey !== undefined) {
        this.pendingRequests.delete(firstKey)
      }
    }
  }
}
