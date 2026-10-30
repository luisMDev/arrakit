const CHUNK_FAILED = /dynamically imported module|Importing a module script failed/i
export const RELOADED_AT_KEY = 'arrakit:stale-chunk-reloaded-at'
const RELOAD_WINDOW_MS = 10_000

export type StaleChunkWindow = Pick<Window, 'sessionStorage' | 'location'>

/**
 * A lazy chunk that would not load because a deploy renamed it: reloads the page, at most once
 * per 10 seconds (blocked sessionStorage means no loop guard, so no reload). True when it reloads.
 */
export function reloadOnStaleChunk(error: unknown, win: StaleChunkWindow = window): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (!CHUNK_FAILED.test(message)) return false
  const now = Date.now()
  try {
    if (now - Number(win.sessionStorage.getItem(RELOADED_AT_KEY) ?? 0) < RELOAD_WINDOW_MS) {
      return false
    }
    win.sessionStorage.setItem(RELOADED_AT_KEY, String(now))
  } catch {
    return false
  }
  win.location.reload()
  return true
}
