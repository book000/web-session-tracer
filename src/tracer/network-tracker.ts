import type { CDPSession } from 'puppeteer-core'
import type { SessionStorage } from '../storage'
import type {
  NetworkFinishedEvent,
  NetworkRequestEvent,
  NetworkResponseEvent,
} from '../types'

/** Largest Unix time (in seconds) that a Date can represent */
const MAX_EPOCH_SECONDS = 8.64e12

/**
 * Time-conversion state for one CDP session.
 * One is created per setup() call, and its object identity identifies the session.
 */
interface SessionClock {
  /** Latest `wallTime - timestamp` (seconds) obtained; null until one is known */
  latestOffset: number | null
  /** Whether the warning about a missing time reference has been logged */
  warned: boolean
}

/** In-flight request info managed by the ring buffer */
interface PendingRequest {
  url: string
  documentUrl: string
  /** `wallTime - timestamp` (seconds) from this request's own requestWillBeSent; null if it could not be computed */
  clockOffset: number | null
  /** SessionClock of the setup() call that registered this entry */
  owner: SessionClock
}

function generateEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Converts a Unix time (seconds) to an ISO 8601 string rounded to milliseconds.
 * Returns null for values a Date cannot represent (including non-finite values).
 * @param seconds - Unix time in seconds
 */
function isoFromEpochSeconds(seconds: number): string | null {
  const date = new Date(Math.round(seconds * 1000))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Computes the offset (seconds) for converting a CDP MonotonicTime
 * (timestamp) to Unix time.
 * Returns null if the values cannot be used for the conversion.
 * @param timestamp - CDP MonotonicTime (seconds)
 * @param wallTime - Unix time (seconds) at the same moment
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
 * Tracks network traffic through the Chrome CDP Network domain.
 *
 * Network events are appended to `network.jsonl` in the current operation
 * directory (getCurrentOpDir) at the time they occur. If no operation
 * directory is set yet, they are discarded.
 *
 * CDP `timestamp` values are MonotonicTime (a monotonic clock), not Unix time.
 * They are converted to Unix time with the offset between the `wallTime` and
 * `timestamp` of requestWillBeSent, and recorded as ISO 8601.
 *
 * A ring buffer limits the memory used by in-flight requests.
 */
export class NetworkTracker {
  private readonly storage: SessionStorage
  private readonly bufferSize: number
  private readonly getCurrentOpDir: () => string | null
  private readonly pendingRequests = new Map<string, PendingRequest>()

  /**
   * @param storage - Session storage
   * @param bufferSize - Maximum size of the ring buffer
   * @param getCurrentOpDir - Returns the current operation directory path, or null if unset
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
   * Registers the network tracking listeners on the CDP session.
   * Sends Network.enable to turn the domain on.
   * @param cdpSession - Target CDPSession
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

      // No usable time reference (e.g. a request already in flight before
      // Network.enable, or an invalid wallTime): use the receive time instead
      if (!clock.warned) {
        clock.warned = true
        console.warn(
          '[NetworkTracker] The CDP time reference (wallTime) is missing or invalid; using the receive time instead'
        )
      }
      return new Date().toISOString()
    }

    const offsetFor = (pending: PendingRequest | undefined): number | null =>
      (pending?.owner === clock ? pending.clockOffset : null) ??
      clock.latestOffset

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
        // Migrating to postDataEntries (base64) would change the recorded format, so it is not done; only the deprecation warning is suppressed
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        postData: event.request.postData,
      }

      this.appendToCurrentOp(tracerEvent)
    })

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

    // Not recorded; only frees the ring buffer slot
    cdpSession.on('Network.loadingFailed', (event) => {
      this.pendingRequests.delete(event.requestId)
    })
  }

  /**
   * Appends a network event to the current operation directory.
   * Discards it if no operation directory is set.
   */
  private appendToCurrentOp(
    event: NetworkRequestEvent | NetworkResponseEvent | NetworkFinishedEvent
  ): void {
    const opDir = this.getCurrentOpDir()
    if (!opDir) return
    this.storage.appendOpNetwork(opDir, event).catch((error: unknown) => {
      console.error('[NetworkTracker] Failed to save the network event:', error)
    })
  }

  /**
   * Removes the oldest entry if the buffer is full (ring buffer).
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
