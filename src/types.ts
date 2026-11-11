/**
 * Session metadata. Saved as `metadata.json` when the session starts.
 */
export interface SessionMetadata {
  sessionId: string
  /** Session start time (ISO 8601) */
  startTime: string
  /** URL of the connected Chrome */
  chromeUrl: string
}

/**
 * Fields shared by all tracer events.
 * Base interface inherited by every event type.
 */
export interface BaseTracerEvent {
  eventId: string
  sessionId: string
  /**
   * URL associated with the event: the main-frame URL for user actions, the
   * destination URL for navigations, and the document URL for network events.
   */
  frameUrl: string
  /** Time the event occurred (ISO 8601) */
  timestamp: string
}

/**
 * User action event: a click, key press, or form interaction.
 * Saved as pretty-printed JSON in `ops/<evNNNNNN>-<frameType>-<action>/event.json`.
 */
export interface UserActionEvent extends BaseTracerEvent {
  type: 'user_action'
  action: 'click' | 'keydown' | 'input' | 'submit'
  tagName: string
  elementId: string
  className: string
  /** Input value (password fields are masked as `***`) */
  value: string
  /** Pressed key (keydown only; `***` in password fields) */
  key?: string
  /**
   * Path of the screenshot taken just before the action, relative to the
   * session directory. Only for click / submit with SCREENSHOT_ENABLED=true.
   * Example: `ops/ev000002-main-click/before.png`
   */
  screenshotBefore?: string
  /**
   * Path of the screenshot taken after the action, relative to the session
   * directory. Only with SCREENSHOT_ENABLED=true.
   * Example: `ops/ev000002-main-click/after.png`
   */
  screenshotAfter?: string
}

/**
 * Importance level of a DOM change.
 *
 * - 1 (noise): almost certainly irrelevant, e.g. changes inside `<head>` or adding/removing only resource-like nodes (SCRIPT, LINK, META, ...) and #comment
 * - 2 (minor): framework-internal state, e.g. characterData changes, `data-*` attributes, or #text-only changes
 * - 3 (significant): visible UI changes, e.g. class / style / hidden / aria-* attributes or adding/removing non-resource elements outside `<head>`
 */
export type MutationLevel = 1 | 2 | 3

/**
 * A single DOM change.
 */
export interface DomChange {
  mutationType: 'childList' | 'attributes' | 'characterData'
  targetPath: string
  /** Tag names of added nodes (childList only) */
  addedNodes?: string[]
  /** Tag names of removed nodes (childList only) */
  removedNodes?: string[]
  /** Name of the changed attribute (attributes only) */
  attributeName?: string
  /** Attribute value after the change (attributes only; `null` if removed) */
  attributeValue?: string | null
  /** Value before the change (attributes only) */
  oldValue?: string | null
  /** Text content (characterData only) */
  characterData?: string
  /**
   * Importance level of the change.
   * Used for post-hoc filtering with tools such as jq.
   * See {@link MutationLevel} for the definition.
   */
  level: MutationLevel
}

/**
 * One line of `ops/<evNNNNNN>-<frameType>-<action>/mutations.jsonl`.
 * Groups the changes from one MutationObserver callback invocation.
 */
export interface OpMutationRecord {
  /** Time the changes were received (ISO 8601) */
  timestamp: string
  /**
   * Highest importance level among the changes in this batch.
   * Used to filter per batch.
   * Example: `jq 'select(.maxLevel >= 3)' mutations.jsonl`
   */
  maxLevel: MutationLevel
  /** Changes reported by the MutationObserver */
  changes: DomChange[]
}

export interface NetworkRequestEvent extends BaseTracerEvent {
  type: 'network_request'
  /** CDP requestId */
  requestId: string
  url: string
  method: string
  headers: Record<string, string>
  /** POST data (if any) */
  postData?: string
}

export interface NetworkResponseEvent extends BaseTracerEvent {
  type: 'network_response'
  /** CDP requestId */
  requestId: string
  url: string
  status: number
  mimeType: string
  headers: Record<string, string>
}

export interface NetworkFinishedEvent extends BaseTracerEvent {
  type: 'network_finished'
  /** CDP requestId */
  requestId: string
  url: string
  /** Number of encoded (e.g. compressed) bytes transferred */
  encodedDataLength: number
}

/**
 * Page navigation event, recorded when a frame's URL changes.
 * Saved as pretty-printed JSON in `ops/<evNNNNNN>-<frameType>-navigation/event.json`.
 */
export interface NavigationEvent extends BaseTracerEvent {
  type: 'navigation'
  url: string
  frameType: 'main' | 'iframe'
}

/**
 * Union of the event types saved as `event.json` under `ops/`.
 */
export type TracerEvent = UserActionEvent | NavigationEvent

/**
 * Union of the network event types saved to `network.jsonl`.
 */
export type NetworkEvent =
  NetworkRequestEvent | NetworkResponseEvent | NetworkFinishedEvent

/**
 * Event data sent from the script injected into the page to Node.js.
 */
export interface InjectedEvent {
  type: 'user_action' | 'mutation'
  /** Frame the event came from (`main`: main frame, `iframe`: subframe) */
  frameType?: 'main' | 'iframe'
  /** Kind of user action (user_action only) */
  action?: 'click' | 'keydown' | 'input' | 'submit'
  tagName?: string
  elementId?: string
  className?: string
  /** Input value (masked as `***` for password fields) */
  value?: string
  /** Name of the pressed key (keydown only) */
  key?: string
  /** Raw DOM changes (mutation only) */
  changes?: RawDomChange[]
}

/**
 * Raw DOM change data received from the injected script,
 * before it is converted to a DomChange.
 */
export interface RawDomChange {
  mutationType: string
  targetPath: string
  addedNodes: string[]
  removedNodes: string[]
  attributeName: string | null
  attributeValue: string | null
  oldValue: string | null
  characterData: string | null
}
