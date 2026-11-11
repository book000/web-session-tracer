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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Traces a single page (tab).
 *
 * Responsibilities:
 * - Network tracking (through NetworkTracker)
 * - Collecting user action events (exposeFunction + injected script)
 * - Collecting DOM changes (MutationObserver -> `mutations.jsonl` in the operation directory)
 * - Recording page navigations and capturing DOM snapshots
 * - Taking screenshots (only when SCREENSHOT_ENABLED=true)
 *
 * Each operation is saved independently in an `ops/<evNNNNNN>-<frameType>-<type>/` directory.
 * Network and mutation events are appended to the current operation directory
 * at the time they occur.
 */
export class PageTracer {
  private readonly page: Page
  private readonly storage: SessionStorage
  private readonly config: TracerConfig
  private readonly networkTracker: NetworkTracker

  private cdpSession: CDPSession | null = null
  private stopped = false

  /**
   * Current operation directory, where network events are written.
   * Set together with currentMutationDir to the newest operation's directory.
   */
  private currentOpDir: string | null = null

  /** Current operation directory, where DOM mutations are written. */
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

  async start(): Promise<void> {
    this.cdpSession = await this.page.createCDPSession()
    await this.networkTracker.setup(this.cdpSession)

    await this.page
      .exposeFunction('__wstEvent', (eventDataStr: string): void => {
        this.handleInjectedEvent(eventDataStr).catch((error: unknown) => {
          console.error('[PageTracer] Injected event handling error:', error)
        })
      })
      .catch(() => {
        // Puppeteer throws if __wstEvent is already registered on this page
      })

    await this.page.evaluateOnNewDocument(getInjectedScript())

    // Also run the script on the page that is already loaded
    try {
      await this.page.evaluate(getInjectedScript())
    } catch {
      // Ignore failures to evaluate, e.g. during a navigation
    }

    this.page.on('framenavigated', (frame: Frame) => {
      this.handleNavigation(frame).catch((error: unknown) => {
        console.error('[PageTracer] Navigation handling error:', error)
      })
    })

    // Record the current main frame as the initial navigation
    const currentUrl = this.page.mainFrame().url()
    if (currentUrl && currentUrl !== 'about:blank') {
      await this.recordNavigation(currentUrl, 'main')
    }

    console.log(`[PageTracer] Tracing started: ${this.page.url()}`)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (!this.cdpSession) {
      return
    }

    await this.cdpSession.detach().catch(() => undefined)
    this.cdpSession = null
  }

  private async handleInjectedEvent(eventDataStr: string): Promise<void> {
    if (this.stopped) return

    let data: InjectedEvent
    try {
      data = JSON.parse(eventDataStr) as InjectedEvent
    } catch {
      console.error(
        '[PageTracer] Failed to parse the event JSON:',
        eventDataStr
      )
      return
    }

    if (data.type === 'user_action' && data.action) {
      await this.saveUserAction(data)
    } else if (data.type === 'mutation' && data.changes) {
      await this.saveMutation(data.changes)
    }
  }

  /**
   * Saves a user action event in `ops/<evNNNNNN>-<frameType>-<action>/`.
   *
   * Screenshot strategy (only when SCREENSHOT_ENABLED=true):
   * - click / submit: take two, one before and one after the action (after the DOM settles).
   * - keydown / input: take only one, after the action (the current input state).
   *
   * Snapshot strategy (only when FULL_SNAPSHOT_ENABLED=true):
   * - Save the DOM snapshot after the action to `snapshot.json`.
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

    let screenshotBefore: string | undefined
    if (isClickLike && this.config.screenshotEnabled) {
      screenshotBefore = await this.takeScreenshot(opDir, 'before')
    }

    // Set before the sleep so mutations and network events that arrive during
    // it are recorded under this operation.
    this.currentMutationDir = opDir
    this.currentOpDir = opDir

    // click / submit wait for the DOM to settle (mutations arrive meanwhile)
    if (isClickLike) {
      await sleep(500)
    }

    let screenshotAfter: string | undefined
    if (this.config.screenshotEnabled) {
      screenshotAfter = await this.takeScreenshot(opDir, 'after')
    }

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
   * Takes a screenshot and saves it.
   * On failure it returns undefined instead of interrupting the caller.
   * @param opDir - Operation directory to save into
   * @param phase - When the screenshot is taken (`before` or `after`)
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
   * Appends a MutationObserver batch to the current operation directory.
   * Discards it if no operation directory is set yet.
   */
  private async saveMutation(rawChanges: RawDomChange[]): Promise<void> {
    const targetDir = this.currentMutationDir
    if (!targetDir || rawChanges.length === 0) return

    const changes: DomChange[] = rawChanges.map((raw) => {
      const change: DomChange = {
        mutationType: raw.mutationType as DomChange['mutationType'],
        targetPath: raw.targetPath,
        level: computeChangeLevel(raw),
        ...(raw.addedNodes.length > 0 && { addedNodes: raw.addedNodes }),
        ...(raw.removedNodes.length > 0 && {
          removedNodes: raw.removedNodes,
        }),
        ...(raw.attributeName !== null && {
          attributeName: raw.attributeName,
          attributeValue: raw.attributeValue,
          oldValue: raw.oldValue,
        }),
        ...(raw.characterData !== null && {
          characterData: raw.characterData,
        }),
      }
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

  private async handleNavigation(frame: Frame): Promise<void> {
    if (this.stopped) return

    const url = frame.url()
    if (!url || url === 'about:blank') return

    const frameType: 'main' | 'iframe' =
      frame === this.page.mainFrame() ? 'main' : 'iframe'
    await this.recordNavigation(url, frameType)
  }

  /**
   * Records a navigation in an operation directory and captures a DOM snapshot.
   * Only for the main frame, it saves the snapshot and updates the current operation directory.
   * @param url - Destination URL
   * @param frameType - Frame type
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

    if (frameType !== 'main') {
      return
    }

    // Save the DOM snapshot after the navigation as a baseline
    await this.captureSnapshot(opDir)
    // Later mutation and network events are written to this navigation directory
    this.currentOpDir = opDir
    this.currentMutationDir = opDir
  }

  /**
   * Saves a DOM snapshot of the current page to `snapshot.json`.
   * @param opDir - Operation directory to save into
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
      console.warn('[PageTracer] Failed to capture the DOM snapshot:', error)
    }
  }

  /**
   * Generates an event ID that is unique within the session.
   * Multiple tabs share one SessionStorage, so the counter is kept on the storage side.
   */
  private nextEventId(): string {
    return this.storage.nextEventId()
  }
}
