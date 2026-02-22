/**
 * トレーサーの動作設定。環境変数から読み込まれる。
 */
export interface TracerConfig {
  /**
   * Chrome リモートデバッグ URL。
   * 環境変数 CHROME_URL で設定 (デフォルト: http://localhost:9222)。
   */
  chromeUrl: string
  /**
   * セッションデータの保存先ディレクトリ。
   * 環境変数 SESSION_DIR で設定 (デフォルト: ./sessions)。
   */
  sessionDir: string
  /**
   * ネットワークリングバッファのサイズ。
   * メモリ上に保持する未完了リクエストの最大数。
   * 環境変数 NETWORK_BUFFER_SIZE で設定 (デフォルト: 1000)。
   */
  networkBufferSize: number
  /**
   * スクリーンショット撮影の有効/無効。
   * 環境変数 SCREENSHOT_ENABLED で設定 (デフォルト: false)。
   * true にすると click / submit の前後、keydown / input の後に PNG を保存する。
   */
  screenshotEnabled: boolean
  /**
   * DOM スナップショット取得の有効/無効。
   * 環境変数 SNAPSHOT_ENABLED で設定 (デフォルト: false)。
   * true にすると、ナビゲーション時に加えてユーザー操作のたびに snapshot.json を保存する。
   */
  snapshotEnabled: boolean
}

/**
 * 環境変数からトレーサーの設定を読み込んで返す。
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
    snapshotEnabled: process.env.SNAPSHOT_ENABLED === 'true',
  }
}
