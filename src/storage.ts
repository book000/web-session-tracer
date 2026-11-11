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
 * Writes session data to the file system.
 *
 * The directory layout and file formats are documented in `sessions/README.md`.
 * `event.json` and `snapshot.json` are pretty-printed JSON; the `.jsonl` files
 * are append-only.
 */
export class SessionStorage {
  readonly sessionId: string
  /** Absolute path of the session directory */
  readonly sessionDir: string

  private opCount = 0
  private eventCount = 0
  private initialized = false

  constructor(baseDir: string, sessionId: string) {
    this.sessionId = sessionId
    this.sessionDir = path.join(baseDir, sessionId)
  }

  /**
   * Creates the session directory and saves the metadata.
   * Must be called before any other method.
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
   * Creates an operation directory and returns its path.
   * The directory name is `evNNNNNN-<frameType>-<type>` (e.g. `ev000001-main-navigation`).
   * @param eventId - Event ID of the operation (ends with `evNNNNNN`)
   * @param frameType - Frame type (`main` or `iframe`)
   * @param type - Operation type (navigation / click / keydown / input / submit)
   * @returns Absolute path of the created `ops/<name>` directory
   */
  async createOpDir(
    eventId: string,
    frameType: 'main' | 'iframe',
    type: string
  ): Promise<string> {
    this.assertInitialized()
    const evPart = /ev\d+$/.exec(eventId)?.[0] ?? eventId
    const dirName = `${evPart}-${frameType}-${type}`
    const opDir = path.join(this.sessionDir, 'ops', dirName)
    await fs.mkdir(opDir, { recursive: true })
    this.opCount++
    return opDir
  }

  async writeOpEvent(
    opDir: string,
    event: NavigationEvent | UserActionEvent
  ): Promise<void> {
    this.assertInitialized()
    await fs.writeFile(
      path.join(opDir, 'event.json'),
      JSON.stringify(event, null, 2),
      'utf8'
    )
  }

  async writeOpSnapshot(opDir: string, snapshot: unknown): Promise<void> {
    this.assertInitialized()
    await fs.writeFile(
      path.join(opDir, 'snapshot.json'),
      JSON.stringify(snapshot, null, 2),
      'utf8'
    )
  }

  async appendOpMutation(
    opDir: string,
    record: OpMutationRecord
  ): Promise<void> {
    this.assertInitialized()
    await fs.appendFile(
      path.join(opDir, 'mutations.jsonl'),
      JSON.stringify(record) + '\n',
      'utf8'
    )
  }

  async appendOpNetwork(opDir: string, event: NetworkEvent): Promise<void> {
    this.assertInitialized()
    await fs.appendFile(
      path.join(opDir, 'network.jsonl'),
      JSON.stringify(event) + '\n',
      'utf8'
    )
  }

  /**
   * Saves a screenshot as a PNG file.
   * @param opDir - Operation directory to save into
   * @param phase - When the screenshot was taken (`before` or `after`)
   * @param pngData - PNG binary data
   * @returns Path relative to the session directory (e.g. `ops/ev000002-main-click/before.png`)
   */
  async writeOpScreenshot(
    opDir: string,
    phase: 'before' | 'after',
    pngData: Buffer
  ): Promise<string> {
    this.assertInitialized()
    const filename = `${phase}.png`
    await fs.writeFile(path.join(opDir, filename), pngData)
    const rel = path.relative(this.sessionDir, path.join(opDir, filename))
    return rel.replaceAll('\\', '/')
  }

  /**
   * Generates a sequential event ID that is unique within the session.
   * Multiple tabs (PageTracer instances) share one SessionStorage, so the
   * counter is kept here to avoid ID collisions such as two `ev000001`.
   * @returns An ID of the form `<sessionId>-ev<6-digit counter>`
   */
  nextEventId(): string {
    this.eventCount++
    return `${this.sessionId}-ev${String(this.eventCount).padStart(6, '0')}`
  }

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
