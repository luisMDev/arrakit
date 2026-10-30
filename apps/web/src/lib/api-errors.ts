import { fallbackORPCErrorMessage } from '@orpc/client'

import { notify } from './notify'

export function statusOf(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
    return err.status
  }
  return 0
}

export function reportError(context: string, err: unknown): void {
  console.error(context, err)
}

/**
 * The API's own message for an error it answered, else `null`. A 500 is an unexpected failure,
 * and oRPC's fallback text for a code or the generic validation text are not the API's words.
 */
export function apiMessage(err: unknown): string | null {
  const status = statusOf(err)
  if (status < 400 || status === 500 || !err || typeof err !== 'object' || !('message' in err))
    return null
  const { message } = err
  if (typeof message !== 'string' || message.trim() === '') return null
  if (message === 'Input validation failed') return null
  const code = 'code' in err && typeof err.code === 'string' ? err.code : null
  if (code && message === fallbackORPCErrorMessage(code, undefined)) return null
  return message
}

/** Reports a failure and toasts the API's own message, or `failure` when it has none. */
export function apiFailed(context: string, err: unknown, failure: string): void {
  reportError(context, err)
  notify.error(apiMessage(err) ?? failure)
}

export interface SaveOnChange<T> {
  (value: T): void
  settled(): Promise<void>
}

/**
 * Saves each change in order, one at a time (settings autosave, no Save button). A failure goes
 * through `apiFailed`, `failed` restores the server values, and the changes queued before the
 * failure are dropped; a change made after it is saved normally.
 */
export function saveOnChange<T, R>(
  save: (value: T) => Promise<R>,
  {
    context,
    failure,
    saved,
    failed,
  }: {
    context: string
    failure: string | (() => string)
    saved?: (result: R) => void
    failed?: (err: unknown) => void
  },
): SaveOnChange<T> {
  let queue: Promise<void> = Promise.resolve()
  let generation = 0
  const change = (value: T) => {
    const queuedIn = generation
    queue = queue.then(async () => {
      if (queuedIn !== generation) return
      try {
        const result = await save(value)
        saved?.(result)
      } catch (err) {
        generation++
        failed?.(err)
        apiFailed(context, err, typeof failure === 'string' ? failure : failure())
      }
    })
  }
  return Object.assign(change, { settled: () => queue })
}
