import puppeteer from 'puppeteer-core'
import { getConfig } from './config'
import { SessionManager } from './tracer/session-manager'

async function main(): Promise<void> {
  const config = getConfig()

  console.log(`[Main] Connecting to Chrome: ${config.chromeUrl}`)

  const browser = await puppeteer.connect({
    browserURL: config.chromeUrl,
    // Leave the viewport to the browser
    defaultViewport: null,
  })

  console.log('[Main] Connected to Chrome')

  const sessionManager = new SessionManager(browser, config)
  await sessionManager.start()

  console.log('[Main] Tracing... (stop with Ctrl+C or SIGTERM)')

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[Main] Shutting down (${signal})`)
    await sessionManager.stop()
    await browser.disconnect()
  }

  // Prevents running the shutdown twice
  let shuttingDown = false
  const handleSignal = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    shutdown(signal)
      .then(() => {
        // eslint-disable-next-line unicorn/no-process-exit
        process.exit(0)
      })
      .catch((error: unknown) => {
        console.error('[Main] Shutdown error:', error)
        // eslint-disable-next-line unicorn/no-process-exit
        process.exit(1)
      })
  }

  process.on('SIGINT', () => {
    handleSignal('SIGINT')
  })
  process.on('SIGTERM', () => {
    handleSignal('SIGTERM')
  })
}

main().catch((error: unknown) => {
  console.error('[Main] Fatal error:', error)
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1)
})
