import type { CDPSession, Frame, Page } from 'puppeteer-core'
import type { TracerConfig } from '../config'
import { getInjectedScript } from '../injected-script'
import type { SessionStorage } from '../storage'
import type {
  DomChange,
  InjectedEvent,
  MutationLevel,
  NavigationEvent,
  OpMutationRecord,
  RawDomChange,
  UserActionEvent,
} from '../types'
import { computeChangeLevel } from './mutation-level'
import { NetworkTracker } from './network-tracker'

/**
 * 指定ミリ秒待機する。
 * @param ms - 待機時間 (ミリ秒)
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 1 ページ (タブ) のトレースを担当するクラス。
 *
 * 担当範囲:
 * - ネットワーク追跡 (NetworkTracker 経由)
 * - ユーザー操作イベントの収集 (exposeFunction + 注入スクリプト)
 * - DOM 変更の収集 (MutationObserver → ops/<id>/mutations.jsonl)
 * - ページナビゲーションの記録と DOM スナップショット取得
 * - スクリーンショットの撮影 (SCREENSHOT_ENABLED=true 時のみ)
 *
 * 各操作は ops/<eventId>-<type>/ ディレクトリに独立して保存される。
 * ネットワーク・Mutation イベントは発生時点の現在操作ディレクトリに追記される。
 */
export class PageTracer {
  private readonly page: Page
  private readonly storage: SessionStorage
  private readonly config: TracerConfig
  private readonly networkTracker: NetworkTracker

  private cdpSession: CDPSession | null = null
  private stopped = false

  /**
   * 現在の操作ディレクトリパス。
   * NetworkTracker・MutationObserver イベントの書き込み先を示す。
   *
   * 非同期処理 (saveUserAction の sleep) 中に次のイベントが到着して
   * 上書きされることを防ぐため、saveMutation は このフィールドではなく
   * currentMutationDir を参照する。
   */
  private currentOpDir: string | null = null

  /**
   * 現在の mutation 書き込み先ディレクトリ。
   * saveUserAction の sleep 開始時点で確定し、sleep 終了後に更新される。
   * これにより、sleep 中に到着した mutation が確実に正しい opDir に書き込まれる。
   */
  private currentMutationDir: string | null = null

  constructor(page: Page, storage: SessionStorage, config: TracerConfig) {
    this.page = page
    this.storage = storage
    this.config = config
    this.networkTracker = new NetworkTracker(
      storage,
      config.networkBufferSize,
      () => this.currentOpDir
    )
  }

  /**
   * ページのトレースを開始する。
   * CDP セッション作成・イベントリスナー設定・スクリプト注入を行う。
   */
  async start(): Promise<void> {
    // CDP セッションを作成してネットワーク追跡を設定
    this.cdpSession = await this.page.createCDPSession()
    await this.networkTracker.setup(this.cdpSession)

    // Node.js 側のイベント受信関数をページに公開
    // 既に登録済みの場合は Puppeteer がエラーをスローするため、catch して無視する
    await this.page
      .exposeFunction('__wstEvent', (eventDataStr: string): void => {
        this.handleInjectedEvent(eventDataStr).catch((error: unknown) => {
          console.error('[PageTracer] 注入イベント処理エラー:', error)
        })
      })
      .catch(() => {
        // 同一ページへの二重登録は無視する
      })

    // 新規ドキュメント読み込み時にイベント収集スクリプトを注入
    await this.page.evaluateOnNewDocument(getInjectedScript())

    // すでに読み込み済みのページにもスクリプトを実行
    try {
      await this.page.evaluate(getInjectedScript())
    } catch {
      // ナビゲーション中などで評価できない場合は無視
    }

    // フレームナビゲーションを監視
    this.page.on('framenavigated', (frame: Frame) => {
      this.handleNavigation(frame).catch((error: unknown) => {
        console.error('[PageTracer] ナビゲーション処理エラー:', error)
      })
    })

    // 現在のメインフレームを初期ナビゲーションとして記録
    const currentUrl = this.page.mainFrame().url()
    if (currentUrl && currentUrl !== 'about:blank') {
      await this.recordNavigation(currentUrl, 'main')
    }

    console.log(`[PageTracer] トレース開始: ${this.page.url()}`)
  }

  /**
   * ページのトレースを停止し、CDP セッションをデタッチする。
   */
  async stop(): Promise<void> {
    this.stopped = true
    if (this.cdpSession) {
      await this.cdpSession.detach().catch(() => undefined)
      this.cdpSession = null
    }
  }

  // ---------- プライベートメソッド ----------

  /**
   * 注入スクリプトから受け取った JSON 文字列をパースして処理する。
   */
  private async handleInjectedEvent(eventDataStr: string): Promise<void> {
    if (this.stopped) return

    let data: InjectedEvent
    try {
      data = JSON.parse(eventDataStr) as InjectedEvent
    } catch {
      console.error('[PageTracer] イベント JSON パース失敗:', eventDataStr)
      return
    }

    if (data.type === 'user_action' && data.action) {
      await this.saveUserAction(data)
    } else if (data.type === 'mutation' && data.changes) {
      await this.saveMutation(data.changes)
    }
  }

  /**
   * ユーザー操作イベントを ops/<eventId>-<frameType>-<action>/ に保存する。
   *
   * スクリーンショット戦略 (SCREENSHOT_ENABLED=true 時のみ):
   * - click / submit: 操作「前」と「後」(500ms 待機後) の 2 枚を撮影する。
   * - keydown / input: 操作「後」(現在の入力状態) の 1 枚のみ撮影する。
   *
   * スナップショット戦略 (FULL_SNAPSHOT_ENABLED=true 時のみ):
   * - 操作後の DOM スナップショットを snapshot.json に保存する。
   */
  private async saveUserAction(data: InjectedEvent): Promise<void> {
    if (!data.action) return

    const eventId = this.nextEventId()
    const frameType = data.frameType ?? 'main'
    const opDir = await this.storage.createOpDir(
      eventId,
      frameType,
      data.action
    )
    const isClickLike = data.action === 'click' || data.action === 'submit'

    // 操作前スクリーンショット (click / submit のみ、スクリーンショット有効時)
    let screenshotBefore: string | undefined
    if (isClickLike && this.config.screenshotEnabled) {
      screenshotBefore = await this.takeScreenshot(opDir, 'before')
    }

    // sleep 前に currentMutationDir を設定し、sleep 中に到着する mutation も記録できるようにする。
    // currentOpDir ではなく専用フィールドを使うことで、高速連続操作時の競合を防ぐ。
    this.currentMutationDir = opDir
    this.currentOpDir = opDir

    // click / submit は DOM が落ち着くまで待機 (この間に mutation が届く)
    if (isClickLike) {
      await sleep(500)
    }

    // 操作後スクリーンショット (スクリーンショット有効時)
    let screenshotAfter: string | undefined
    if (this.config.screenshotEnabled) {
      screenshotAfter = await this.takeScreenshot(opDir, 'after')
    }

    // 操作後 DOM スナップショット (FULL_SNAPSHOT_ENABLED=true 時)
    if (this.config.fullSnapshotEnabled) {
      await this.captureSnapshot(opDir)
    }

    const event: UserActionEvent = {
      eventId,
      sessionId: this.storage.sessionId,
      frameUrl: this.page.mainFrame().url(),
      timestamp: new Date().toISOString(),
      type: 'user_action',
      action: data.action,
      tagName: data.tagName ?? '',
      elementId: data.elementId ?? '',
      className: data.className ?? '',
      value: data.value ?? '',
      key: data.key,
      screenshotBefore,
      screenshotAfter,
    }
    await this.storage.writeOpEvent(opDir, event)
  }

  /**
   * スクリーンショットを撮影して保存する。
   * 失敗しても undefined を返して呼び出し元の処理を止めない。
   * @param opDir - 保存先の操作ディレクトリ
   * @param phase - 撮影タイミング ('before' | 'after')
   */
  private async takeScreenshot(
    opDir: string,
    phase: 'before' | 'after'
  ): Promise<string | undefined> {
    try {
      const buffer = await this.page.screenshot({ type: 'png' })
      return await this.storage.writeOpScreenshot(
        opDir,
        phase,
        Buffer.from(buffer)
      )
    } catch {
      return undefined
    }
  }

  /**
   * MutationObserver の変更バッチを現在の操作ディレクトリに追記する。
   * 操作ディレクトリが未設定 (操作前) の場合は破棄する。
   */
  private async saveMutation(rawChanges: RawDomChange[]): Promise<void> {
    const targetDir = this.currentMutationDir
    if (!targetDir || rawChanges.length === 0) return

    const changes: DomChange[] = rawChanges.map((raw) => {
      const change: DomChange = {
        mutationType: raw.mutationType as DomChange['mutationType'],
        targetPath: raw.targetPath,
        level: computeChangeLevel(raw),
      }
      if (raw.addedNodes.length > 0) change.addedNodes = raw.addedNodes
      if (raw.removedNodes.length > 0) change.removedNodes = raw.removedNodes
      if (raw.attributeName !== null) {
        change.attributeName = raw.attributeName
        change.attributeValue = raw.attributeValue
        change.oldValue = raw.oldValue
      }
      if (raw.characterData !== null) change.characterData = raw.characterData
      return change
    })

    let maxLevel: MutationLevel = 1
    for (const c of changes) {
      maxLevel = Math.max(maxLevel, c.level) as MutationLevel
    }

    const record: OpMutationRecord = {
      timestamp: new Date().toISOString(),
      maxLevel,
      changes,
    }
    await this.storage.appendOpMutation(targetDir, record)
  }

  /**
   * フレームナビゲーションイベントを処理する。
   */
  private async handleNavigation(frame: Frame): Promise<void> {
    if (this.stopped) return

    const url = frame.url()
    if (!url || url === 'about:blank') return

    const frameType: 'main' | 'iframe' =
      frame === this.page.mainFrame() ? 'main' : 'iframe'
    await this.recordNavigation(url, frameType)
  }

  /**
   * ナビゲーションを操作ディレクトリに記録し、DOM スナップショットを取得する。
   * メインフレームの場合のみスナップショットを保存し currentOpDir を更新する。
   * @param url - ナビゲーション先 URL
   * @param frameType - フレームの種別
   */
  private async recordNavigation(
    url: string,
    frameType: 'main' | 'iframe'
  ): Promise<void> {
    const eventId = this.nextEventId()
    const opDir = await this.storage.createOpDir(
      eventId,
      frameType,
      'navigation'
    )

    const event: NavigationEvent = {
      eventId,
      sessionId: this.storage.sessionId,
      frameUrl: url,
      timestamp: new Date().toISOString(),
      type: 'navigation',
      url,
      frameType,
    }
    await this.storage.writeOpEvent(opDir, event)

    if (frameType === 'main') {
      // ナビゲーション後の DOM スナップショットをベースラインとして保存
      await this.captureSnapshot(opDir)
      // 以降の mutation・ネットワークイベントはこのナビゲーションディレクトリに書き込む
      this.currentOpDir = opDir
      this.currentMutationDir = opDir
    }
  }

  /**
   * 現在のページの DOM スナップショットを snapshot.json に保存する。
   * @param opDir - 保存先の操作ディレクトリ
   */
  private async captureSnapshot(opDir: string): Promise<void> {
    if (!this.cdpSession) return

    try {
      const snapshot = await this.cdpSession.send(
        'DOMSnapshot.captureSnapshot',
        { computedStyles: [] }
      )
      await this.storage.writeOpSnapshot(opDir, snapshot)
    } catch (error) {
      console.warn('[PageTracer] DOM スナップショット取得失敗:', error)
    }
  }

  /**
   * セッション全体でユニークなイベント ID を生成する。
   * 複数タブが同じ SessionStorage を共有するため、カウンタは storage 側で一元管理する。
   */
  private nextEventId(): string {
    return this.storage.nextEventId()
  }
}
