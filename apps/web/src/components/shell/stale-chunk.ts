const CHUNK_FAILED = /dynamically imported module|Importing a module script failed/i
export const RETRIED_AT_KEY = 'arrakit:stale-chunk-retried-at'
const RETRY_WINDOW_MS = 10_000

export type StaleChunkWindow = Pick<Window, 'sessionStorage' | 'fetch' | 'location' | 'document'>

interface Retry {
  /** The chunk URL named by the error (Chrome, Firefox); Safari names none. */
  chunk: string | undefined
}

/**
 * Decides, synchronously, whether `error` is a stale chunk worth one reload: it must look like a
 * failed dynamic import and no retry may have happened in the last 10 seconds. Claims the retry
 * (stores the time) when it says yes. Blocked sessionStorage means no loop guard, so no retry.
 */
function claimRetry(error: unknown, win: StaleChunkWindow): Retry | null {
  const message = error instanceof Error ? error.message : String(error)
  if (!CHUNK_FAILED.test(message)) return null
  const now = Date.now()
  try {
    if (now - Number(win.sessionStorage.getItem(RETRIED_AT_KEY) ?? 0) < RETRY_WINDOW_MS) {
      return null
    }
    win.sessionStorage.setItem(RETRIED_AT_KEY, String(now))
  } catch {
    return null
  }
  return { chunk: /https?:\/\/\S+?\.js/.exec(message)?.[0] }
}

async function reload({ chunk }: Retry, targetUrl: string, win: StaleChunkWindow): Promise<void> {
  if (chunk) await win.fetch(chunk, { cache: 'reload' }).catch(() => undefined)
  win.location.assign(new URL(targetUrl, win.document.baseURI).href)
}

/**
 * A navigation whose lazy chunk would not load because a deploy renamed it (or a CDN cached
 * index.html in its place). Fetches the chunk again past the HTTP cache, then hard-loads the
 * target URL once per 10 seconds. True when it reloads.
 */
export async function recoverFromStaleChunk(
  error: unknown,
  targetUrl: string,
  win: StaleChunkWindow,
): Promise<boolean> {
  const retry = claimRetry(error, win)
  if (!retry) return false
  await reload(retry, targetUrl, win)
  return true
}

/** Vite's `vite:preloadError` window event: the failed import is in `payload`. */
export type PreloadErrorEvent = Event & { payload?: unknown }

/**
 * Handles Vite's `vite:preloadError`: when the failure is a stale chunk worth a reload, cancels
 * the event (so Vite does not rethrow it) and recovers. The decision is synchronous because
 * `preventDefault()` only counts while the event is being dispatched.
 */
export function onPreloadError(
  event: PreloadErrorEvent,
  targetUrl: string,
  win: StaleChunkWindow,
): void {
  const retry = claimRetry(event.payload, win)
  if (!retry) return
  event.preventDefault()
  void reload(retry, targetUrl, win)
}
