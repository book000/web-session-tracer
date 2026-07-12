import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  NetworkEvent,
  NavigationEvent,
  OpMutationRecord,
  SessionMetadata,
  UserActionEvent,
} from './types'

/**
 * セッションデータをファイルシステムに書き込むストレージクラス。
 *
 * ディレクトリ構成:
 * ```
 * <baseDirectory>/<sessionId>/
 *   metadata.json
 *   ops/
 *     ev000001-main-navigation/
 *       event.json        操作イベント (整形済み JSON)
 *       snapshot.json     フル DOM スナップショット (navigation のみ、または FULL_SNAPSHOT_ENABLED=true 時)
 *       network.jsonl     この操作中に発生したネットワーク通信 (複数行 JSONL)
 *     ev000002-main-click/
 *       event.json
 *       mutations.jsonl   MutationObserver 差分 (複数行 JSONL)
 *       network.jsonl
 *       before.png        (SCREENSHOT_ENABLED=true 時)
 *       after.png
 * ```
 */
export class SessionStorage {
  /** セッション識別子 */
  readonly sessionId: string
  /** セッションディレクトリの絶対パス */
  readonly sessionDir: string

  private opCount = 0
  private eventCount = 0
  private initialized = false

  constructor(baseDirectory: string, sessionId: string) {
    this.sessionId = sessionId
    this.sessionDir = path.join(baseDirectory, sessionId)
  }

  /**
   * セッションディレクトリを作成しメタデータを保存する。
   * 他のメソッドより先に呼び出す必要がある。
   */
  async initialize(metadata: SessionMetadata): Promise<void> {
    await fs.mkdir(path.join(this.sessionDir, 'ops'), { recursive: true })
    await fs.writeFile(
      path.join(this.sessionDir, 'metadata.json'),
      JSON.stringify(metadata),
      'utf8'
    )
    this.initialized = true
  }

  /**
   * 操作ディレクトリを作成して返す。
   * ディレクトリ名は「evNNNNNN-<frameType>-<type>」形式 (例: ev000001-main-navigation)。
   * @param eventId - 操作イベントの ID (末尾が evNNNNNN の形式)
   * @param frameType - フレームの種別 ('main' | 'iframe')
   * @param type - 操作種別 (navigation / click / keydown / input / submit)
   * @returns 作成した ops/<name> の絶対パス
   */
  async createOpDir(
    eventId: string,
    frameType: 'main' | 'iframe',
    type: string
  ): Promise<string> {
    this.assertInitialized()
    const eventPart = /ev\d+$/.exec(eventId)?.[0] ?? eventId
    const directoryName = `${eventPart}-${frameType}-${type}`
    const opDirectory = path.join(this.sessionDir, 'ops', directoryName)
    await fs.mkdir(opDirectory, { recursive: true })
    this.opCount++
    return opDirectory
  }

  /**
   * 操作イベントを event.json に整形済み JSON で書き込む。
   * @param opDirectory - 操作ディレクトリの絶対パス
   * @param event - 保存するイベント
   */
  async writeOpEvent(
    opDirectory: string,
    event: NavigationEvent | UserActionEvent
  ): Promise<void> {
    this.assertInitialized()
    await fs.writeFile(
      path.join(opDirectory, 'event.json'),
      JSON.stringify(event, null, 2),
      'utf8'
    )
  }

  /**
   * DOM スナップショットを snapshot.json に整形済み JSON で書き込む。
   * ナビゲーション操作時、および FULL_SNAPSHOT_ENABLED=true 時のユーザー操作後に使用する。
   * @param opDirectory - 操作ディレクトリの絶対パス
   * @param snapshot - DOMSnapshot.captureSnapshot の返却値
   */
  async writeOpSnapshot(opDirectory: string, snapshot: unknown): Promise<void> {
    this.assertInitialized()
    await fs.writeFile(
      path.join(opDirectory, 'snapshot.json'),
      JSON.stringify(snapshot, null, 2),
      'utf8'
    )
  }

  /**
   * MutationObserver の変更バッチを mutations.jsonl に 1 行追記する。
   * @param opDirectory - 操作ディレクトリの絶対パス
   * @param record - 変更バッチレコード
   */
  async appendOpMutation(
    opDirectory: string,
    record: OpMutationRecord
  ): Promise<void> {
    this.assertInitialized()
    await fs.appendFile(
      path.join(opDirectory, 'mutations.jsonl'),
      JSON.stringify(record) + '\n',
      'utf8'
    )
  }

  /**
   * ネットワークイベントを network.jsonl に 1 行追記する。
   * @param opDirectory - 操作ディレクトリの絶対パス
   * @param event - 保存するネットワークイベント
   */
  async appendOpNetwork(
    opDirectory: string,
    event: NetworkEvent
  ): Promise<void> {
    this.assertInitialized()
    await fs.appendFile(
      path.join(opDirectory, 'network.jsonl'),
      JSON.stringify(event) + '\n',
      'utf8'
    )
  }

  /**
   * スクリーンショットを PNG ファイルとして保存する。
   * @param opDirectory - 操作ディレクトリの絶対パス
   * @param phase - 撮影タイミング ('before' | 'after')
   * @param pngData - PNG バイナリデータ
   * @returns セッションディレクトリからの相対パス (例: ops/ev000002-main-click/before.png)
   */
  async writeOpScreenshot(
    opDirectory: string,
    phase: 'before' | 'after',
    pngData: Buffer
  ): Promise<string> {
    this.assertInitialized()
    const filename = `${phase}.png`
    await fs.writeFile(path.join(opDirectory, filename), pngData)
    const relative = path.relative(
      this.sessionDir,
      path.join(opDirectory, filename)
    )
    return relative.replaceAll('\\', '/')
  }

  /**
   * セッション全体でユニークな連番イベント ID を生成する。
   * 複数タブ (PageTracer) が同じ SessionStorage を共有するため、
   * カウンタをここで一元管理することで ev000001 等の衝突を防ぐ。
   * @returns 「<sessionId>-ev<6桁連番>」形式の ID
   */
  nextEventId(): string {
    this.eventCount++
    return `${this.sessionId}-ev${String(this.eventCount).padStart(6, '0')}`
  }

  /** 作成済み操作ディレクトリの総数 */
  get opTotal(): number {
    return this.opCount
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'SessionStorage is not initialized. Call initialize() first.'
      )
    }
  }
}
