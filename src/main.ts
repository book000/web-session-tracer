import puppeteer from 'puppeteer-core'
import { getConfig } from './config'
import { SessionManager } from './tracer/session-manager'

/**
 * アプリケーションのエントリーポイント。
 *
 * 処理フロー:
 * 1. 環境変数から設定を読み込む
 * 2. 既に起動済みの Chrome (CDPポート公開済み) に接続する
 * 3. SessionManager を起動してユーザー操作の記録を開始する
 * 4. SIGINT / SIGTERM を受信したらグレースフルシャットダウンする
 */
async function main(): Promise<void> {
  const config = getConfig()

  console.log(`[Main] Chrome に接続中: ${config.chromeUrl}`)

  const browser = await puppeteer.connect({
    browserURL: config.chromeUrl,
    // ビューポートはブラウザ側に委ねる
    defaultViewport: null,
  })

  console.log('[Main] Chrome への接続成功')

  const sessionManager = new SessionManager(browser, config)
  await sessionManager.start()

  console.log('[Main] トレース中... (Ctrl+C または SIGTERM で停止)')

  // グレースフルシャットダウン
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[Main] シャットダウン開始 (${signal})`)
    await sessionManager.stop()
    await browser.disconnect()
  }

  process.on('SIGINT', () => {
    shutdown('SIGINT')
      .catch((error: unknown) => {
        console.error('[Main] シャットダウンエラー:', error)
      })
      .finally(() => {
        process.exit(0)
      })
  })

  process.on('SIGTERM', () => {
    shutdown('SIGTERM')
      .catch((error: unknown) => {
        console.error('[Main] シャットダウンエラー:', error)
      })
      .finally(() => {
        process.exit(0)
      })
  })
}

main().catch((error: unknown) => {
  console.error('[Main] 致命的エラー:', error)
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1)
})
