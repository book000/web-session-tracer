/**
 * Each of the two sequential drains in `PageTracer.stop()` must fit, together,
 * inside Docker's default 10 s stop grace period.
 */
export const DRAIN_TIMEOUT_MS = 4000

/**
 * Tracks in-flight promises so shutdown can wait for them to settle.
 */
export class PendingTasks {
  private readonly tasks = new Set<Promise<unknown>>()

  /**
   * Registers a promise until it settles. Returns the same promise, so the
   * caller keeps its own error handling.
   */
  track<T>(promise: Promise<T>): Promise<T> {
    const remove = (): void => {
      this.tasks.delete(promise)
    }
    this.tasks.add(promise)
    // Not `.finally()`: its derived promise would reject unhandled.
    promise.then(remove, remove)
    return promise
  }

  /**
   * Waits until every tracked promise has settled, including ones tracked
   * while draining. Never rejects; logs a warning and resolves on timeout.
   * @param timeoutMs - Upper bound of the wait in milliseconds
   */
  async drain(timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timeout')
      }, timeoutMs)
    })

    const settled = async (): Promise<'settled'> => {
      while (this.tasks.size > 0) {
        await Promise.allSettled(this.tasks)
      }
      return 'settled'
    }

    const result = await Promise.race([settled(), timeout])
    clearTimeout(timer)
    if (result === 'timeout') {
      console.warn(
        `[PendingTasks] Drain timed out with ${this.tasks.size} task(s) still pending`
      )
    }
  }
}
