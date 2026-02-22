import path from 'node:path'
import { TargetType, type Browser, type Target } from 'puppeteer-core'
import type { TracerConfig } from '../config'
import { SessionStorage } from '../storage'
import type { SessionMetadata } from '../types'
import { PageTracer } from './page-tracer'

/**
 * 数値を 2 桁にゼロパディングして返す。
 * @param n - パディング対象の数値
 */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * セッション ID を生成する。
 * 形式: session-YYYYMMDD-HHmmss
 */
function generateSessionId(): string {
  const now = new Date()
  const datePart = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('')
  const timePart = [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('')
  return `session-${datePart}-${timePart}`
}

/**
 * ブラウザ全体のセッション管理を担当するクラス。
 *
 * 1 回の実行を 1 セッションとして管理し、
 * 既存・新規ページの両方にトレーサーをアタッチする。
 * ページ (Target) の作成・破棄を監視し、PageTracer のライフサイクルを管理する。
 */
export class SessionManager {
  private readonly browser: Browser
  private readonly config: TracerConfig
  private readonly storage: SessionStorage
  private readonly pageTracers = new Map<Target, PageTracer>()

  private running = false

  constructor(browser: Browser, config: TracerConfig) {
    this.browser = browser
    this.config = config

    const sessionId = generateSessionId()
    this.storage = new SessionStorage(
      path.resolve(config.sessionDir),
      sessionId
    )
  }

  /**
   * セッション管理を開始する。
   * セッションディレクトリを作成し、既存・新規ページを追跡する。
   */
  async start(): Promise<void> {
    this.running = true

    const metadata: SessionMetadata = {
      sessionId: this.storage.sessionId,
      startTime: new Date().toISOString(),
      chromeUrl: this.config.chromeUrl,
    }
    await this.storage.initialize(metadata)

    console.log(`[SessionManager] セッション開始: ${this.storage.sessionId}`)
    console.log(`[SessionManager] 保存先: ${this.storage.sessionDir}`)

    // すでに開いているページを追跡
    const existingTargets = this.browser.targets()
    for (const target of existingTargets) {
      if (target.type() === TargetType.PAGE) {
        await this.attachToTarget(target)
      }
    }

    // 新規タブの監視
    this.browser.on('targetcreated', (target: Target) => {
      if (target.type() === TargetType.PAGE) {
        this.attachToTarget(target).catch((error: unknown) => {
          console.error(
            '[SessionManager] 新規ターゲットへのアタッチに失敗:',
            error
          )
        })
      }
    })

    // タブ閉鎖の監視
    this.browser.on('targetdestroyed', (target: Target) => {
      const tracer = this.pageTracers.get(target)
      if (tracer) {
        tracer.stop().catch((error: unknown) => {
          console.error('[SessionManager] PageTracer 停止エラー:', error)
        })
        this.pageTracers.delete(target)
      }
    })
  }

  /**
   * セッション管理を停止する。
   * 全 PageTracer を停止して記録を完了する。
   */
  async stop(): Promise<void> {
    this.running = false

    await Promise.all(
      [...this.pageTracers.values()].map((tracer) =>
        tracer.stop().catch((error: unknown) => {
          console.error('[SessionManager] PageTracer 停止エラー:', error)
        })
      )
    )
    this.pageTracers.clear()

    console.log(
      `[SessionManager] セッション終了: ${this.storage.sessionId}` +
        ` (記録操作数: ${this.storage.opTotal})`
    )
  }

  /**
   * 指定ターゲットに PageTracer をアタッチして追跡を開始する。
   */
  private async attachToTarget(target: Target): Promise<void> {
    if (!this.running) return

    const page = await target.page()
    if (!page) return

    const tracer = new PageTracer(page, this.storage, this.config)
    this.pageTracers.set(target, tracer)

    try {
      await tracer.start()
    } catch (error) {
      console.error('[SessionManager] PageTracer 開始エラー:', error)
      this.pageTracers.delete(target)
    }
  }
}
