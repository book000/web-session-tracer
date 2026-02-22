/**
 * セッションメタデータ。セッション開始時に metadata.json として保存される。
 */
export interface SessionMetadata {
  /** セッション識別子 */
  sessionId: string
  /** セッション開始日時 (ISO 8601) */
  startTime: string
  /** 接続した Chrome の URL */
  chromeUrl: string
}

/**
 * トレーサーイベントの共通フィールド。
 * すべてのイベント型が継承する基底インターフェース。
 */
export interface BaseTracerEvent {
  /** イベント一意識別子 */
  eventId: string
  /** このイベントが属するセッション ID */
  sessionId: string
  /** イベント発生元フレームの URL (window.location.href) */
  frameUrl: string
  /** イベント発生日時 (ISO 8601) */
  timestamp: string
}

/**
 * ユーザー操作イベント。クリック・キー入力・フォーム操作を記録する。
 * ops/<eventId>-<frameType>-<action>/event.json に整形済み JSON で保存される。
 */
export interface UserActionEvent extends BaseTracerEvent {
  type: 'user_action'
  /** 操作の種別 */
  action: 'click' | 'keydown' | 'input' | 'submit'
  /** 対象要素のタグ名 */
  tagName: string
  /** 対象要素の id 属性 */
  elementId: string
  /** 対象要素の class 属性 */
  className: string
  /** 入力値 (パスワードは *** にマスクされる) */
  value: string
  /** 押下されたキー (keydown のみ。パスワードフィールドでは ***) */
  key?: string
  /**
   * 操作直前のスクリーンショット相対パス。click / submit かつ SCREENSHOT_ENABLED=true 時のみ。
   * 例: ops/ev000002-main-click/before.png
   */
  screenshotBefore?: string
  /**
   * 操作後のスクリーンショット相対パス。SCREENSHOT_ENABLED=true 時のみ。
   * 例: ops/ev000002-main-click/after.png
   */
  screenshotAfter?: string
}

/**
 * DOM の個別変更レコード。
 */
/**
 * DOM 変更の重要度レベル。
 *
 * - 1 (noise): &lt;head&gt; 内変更・SCRIPT/LINK/META/#comment の追加削除など、ほぼ確実に不要なノイズ
 * - 2 (minor): characterData 変更・data-* 属性・#text のみの変更など、フレームワーク内部状態
 * - 3 (significant): class/style/hidden/aria-* 属性・body への要素追加削除など、目に見える UI 変化
 */
export type MutationLevel = 1 | 2 | 3

export interface DomChange {
  /** 変更の種別 */
  mutationType: 'childList' | 'attributes' | 'characterData'
  /** 変更対象ノードの XPath */
  targetPath: string
  /** 追加されたノードのタグ名リスト (childList のみ) */
  addedNodes?: string[]
  /** 削除されたノードのタグ名リスト (childList のみ) */
  removedNodes?: string[]
  /** 変更された属性名 (attributes のみ) */
  attributeName?: string
  /** 変更後の属性値 (attributes のみ) */
  attributeValue?: string | null
  /** 変更前の値 */
  oldValue?: string | null
  /** テキスト内容 (characterData のみ) */
  characterData?: string
  /**
   * 変更の重要度レベル。
   * jq 等での後処理フィルタリングに使用する。
   * 定義は {@link MutationLevel} を参照。
   */
  level: MutationLevel
}

/**
 * ops/<eventId>-<frameType>-<action>/mutations.jsonl の 1 行に相当するレコード。
 * MutationObserver の 1 回のコールバック呼び出し分の変更をまとめたもの。
 */
export interface OpMutationRecord {
  /** 変更検知日時 (ISO 8601) */
  timestamp: string
  /**
   * このバッチに含まれる変更の最大重要度レベル。
   * バッチ単位でフィルタする際に使用する。
   * 例: `jq 'select(.maxLevel >= 3)' mutations.jsonl`
   */
  maxLevel: MutationLevel
  /** MutationObserver が検知した変更リスト */
  changes: DomChange[]
}

/**
 * ネットワークリクエスト送信イベント。
 */
export interface NetworkRequestEvent extends BaseTracerEvent {
  type: 'network_request'
  /** CDP requestId */
  requestId: string
  /** リクエスト URL */
  url: string
  /** HTTP メソッド */
  method: string
  /** リクエストヘッダー */
  headers: Record<string, string>
  /** POST データ (存在する場合) */
  postData?: string
}

/**
 * ネットワークレスポンス受信イベント。
 */
export interface NetworkResponseEvent extends BaseTracerEvent {
  type: 'network_response'
  /** CDP requestId */
  requestId: string
  /** レスポンス URL */
  url: string
  /** HTTP ステータスコード */
  status: number
  /** コンテンツの MIME タイプ */
  mimeType: string
  /** レスポンスヘッダー */
  headers: Record<string, string>
}

/**
 * ネットワークロード完了イベント。
 */
export interface NetworkFinishedEvent extends BaseTracerEvent {
  type: 'network_finished'
  /** CDP requestId */
  requestId: string
  /** リクエスト URL */
  url: string
  /** 転送されたエンコード済みデータのバイト数 */
  encodedDataLength: number
}

/**
 * ページナビゲーションイベント。URL 変更時に記録される。
 * ops/<eventId>-<frameType>-navigation/event.json に整形済み JSON で保存される。
 */
export interface NavigationEvent extends BaseTracerEvent {
  type: 'navigation'
  /** ナビゲーション先 URL */
  url: string
  /** フレームの種別 */
  frameType: 'main' | 'iframe'
}

/**
 * ops/ 配下の event.json に保存されるイベント型のユニオン。
 */
export type TracerEvent = UserActionEvent | NavigationEvent

/**
 * network.jsonl に保存されるネットワークイベント型のユニオン。
 */
export type NetworkEvent =
  | NetworkRequestEvent
  | NetworkResponseEvent
  | NetworkFinishedEvent

/**
 * ページに注入したスクリプトから Node.js へ送信されるイベントデータ。
 */
export interface InjectedEvent {
  /** イベント大分類 */
  type: 'user_action' | 'mutation'
  /** イベント発生元フレームの種別 (main: メインフレーム, iframe: サブフレーム) */
  frameType?: 'main' | 'iframe'
  /** ユーザー操作の種別 (user_action のみ) */
  action?: 'click' | 'keydown' | 'input' | 'submit'
  /** 対象要素のタグ名 */
  tagName?: string
  /** 対象要素の id 属性 */
  elementId?: string
  /** 対象要素の class 属性 */
  className?: string
  /** 入力値またはキー名 */
  value?: string
  /** 押下されたキー名 (keydown のみ) */
  key?: string
  /** DOM 変更の生データリスト (mutation のみ) */
  changes?: RawDomChange[]
}

/**
 * 注入スクリプトから受け取る生の DOM 変更データ。
 * DomChange へ変換される前の形式。
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
