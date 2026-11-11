/**
 * Tracer settings, loaded from environment variables.
 */
export interface TracerConfig {
  /**
   * Chrome remote debugging URL.
   * Set via `CHROME_URL` (default: `http://localhost:9222`).
   */
  chromeUrl: string
  /**
   * Directory where session data is stored.
   * Set via `SESSION_DIR` (default: `./sessions`).
   */
  sessionDir: string
  /**
   * Maximum number of in-flight requests kept in memory (ring buffer size).
   * Set via `NETWORK_BUFFER_SIZE` (default: 1000).
   */
  networkBufferSize: number
  /**
   * Whether to save screenshots.
   * Set via `SCREENSHOT_ENABLED` (default: false; only the exact string `true`
   * enables it). When enabled, a PNG is saved before and after click / submit
   * and after keydown / input.
   */
  screenshotEnabled: boolean
  /**
   * Whether to also capture a DOM snapshot after every user action.
   * Set via `FULL_SNAPSHOT_ENABLED` (default: false; only the exact string
   * `true` enables it). Main-frame navigations are always snapshotted.
   */
  fullSnapshotEnabled: boolean
}

/**
 * Reads the tracer settings from environment variables.
 */
export function getConfig(): TracerConfig {
  return {
    chromeUrl: process.env.CHROME_URL ?? 'http://localhost:9222',
    sessionDir: process.env.SESSION_DIR ?? './sessions',
    networkBufferSize: (() => {
      const raw = Number(process.env.NETWORK_BUFFER_SIZE ?? 1000)
      return Number.isNaN(raw) || raw <= 0 ? 1000 : raw
    })(),
    screenshotEnabled: process.env.SCREENSHOT_ENABLED === 'true',
    fullSnapshotEnabled: process.env.FULL_SNAPSHOT_ENABLED === 'true',
  }
}
