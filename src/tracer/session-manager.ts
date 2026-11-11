import path from 'node:path'
import { TargetType, type Browser, type Target } from 'puppeteer-core'
import type { TracerConfig } from '../config'
import { SessionStorage } from '../storage'
import type { SessionMetadata } from '../types'
import { PageTracer } from './page-tracer'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Generates a session ID in the local time zone.
 * Format: `session-YYYYMMDD-HHmmssSSS` (includes milliseconds, so restarting
 * within the same second does not collide on the directory name).
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
  const msPart = String(now.getMilliseconds()).padStart(3, '0')
  return `session-${datePart}-${timePart}${msPart}`
}

/**
 * Manages the session for the whole browser.
 *
 * One run is one session. It attaches a tracer to both existing and new
 * pages, and watches page (Target) creation and destruction to manage the
 * PageTracer lifecycle.
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

  async start(): Promise<void> {
    this.running = true

    const metadata: SessionMetadata = {
      sessionId: this.storage.sessionId,
      startTime: new Date().toISOString(),
      chromeUrl: this.config.chromeUrl,
    }
    await this.storage.initialize(metadata)

    console.log(`[SessionManager] Session started: ${this.storage.sessionId}`)
    console.log(`[SessionManager] Output directory: ${this.storage.sessionDir}`)

    const existingTargets = this.browser.targets()
    for (const target of existingTargets) {
      if (target.type() === TargetType.PAGE) {
        await this.attachToTarget(target)
      }
    }

    this.browser.on('targetcreated', (target: Target) => {
      if (target.type() === TargetType.PAGE) {
        this.attachToTarget(target).catch((error: unknown) => {
          console.error(
            '[SessionManager] Failed to attach to the new target:',
            error
          )
        })
      }
    })

    this.browser.on('targetdestroyed', (target: Target) => {
      const tracer = this.pageTracers.get(target)
      if (!tracer) {
        return
      }

      tracer.stop().catch((error: unknown) => {
        console.error('[SessionManager] PageTracer stop error:', error)
      })
      this.pageTracers.delete(target)
    })
  }

  async stop(): Promise<void> {
    this.running = false

    await Promise.all(
      this.pageTracers.values().map((tracer) =>
        tracer.stop().catch((error: unknown) => {
          console.error('[SessionManager] PageTracer stop error:', error)
        })
      )
    )
    this.pageTracers.clear()

    console.log(
      `[SessionManager] Session ended: ${this.storage.sessionId}` +
        ` (recorded operations: ${this.storage.opTotal})`
    )
  }

  private async attachToTarget(target: Target): Promise<void> {
    if (!this.running) return

    const page = await target.page()
    if (!page) return

    const tracer = new PageTracer(page, this.storage, this.config)
    this.pageTracers.set(target, tracer)

    try {
      await tracer.start()
    } catch (error) {
      console.error('[SessionManager] PageTracer start error:', error)
      this.pageTracers.delete(target)
    }
  }
}
