import { fallbackORPCErrorMessage } from '@orpc/client'

import { notify } from './notify'

export function statusOf(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
    return err.status
  }
  return 0
}

/** Logs an unexpected failure (one place to plug an error reporter later). */
export function reportError(context: string, err: unknown): void {
  console.error(context, err)
}

const GENERIC_MESSAGES = new Set(['Input validation failed'])

function ownMessage(err: unknown): string | null {
  if (!err || typeof err !== 'object' || !('message' in err)) return null
  const { message } = err
  if (typeof message !== 'string' || message.trim() === '') return null
  if (GENERIC_MESSAGES.has(message)) return null
  const code = 'code' in err && typeof err.code === 'string' ? err.code : null
  if (code && message === fallbackORPCErrorMessage(code, undefined)) return null
  return message
}

const is4xx = (status: number) => status >= 400 && status < 500

/** The API's own message for an error answered with a status `accepts` takes, else `null`. */
export function apiMessage(
  err: unknown,
  accepts: (status: number) => boolean = is4xx,
): string | null {
  return accepts(statusOf(err)) ? ownMessage(err) : null
}

const REFUSALS = new Set([400, 403])

/** The API's own reason when it refused a request on its merits, else `null`. */
export function refusalMessage(err: unknown): string | null {
  return apiMessage(err, (status) => REFUSALS.has(status))
}

/** Payments also pass on 502 (Stripe refused) and 503 (payments not set up). */
const PAYMENT_REFUSALS = new Set([400, 402, 403, 409, 502, 503])

export function paymentRefusal(err: unknown): string | null {
  return apiMessage(err, (status) => PAYMENT_REFUSALS.has(status))
}

/** The API's own reason for a 409 conflict, else `null`. */
export function conflictRefusal(err: unknown): string | null {
  return apiMessage(err, (status) => status === 409)
}

/** Never the API's message: the screen's own text always. */
export const noRefusal = (): null => null

/** Reports a failure and toasts the API's own message (`refusal`), or `failure` otherwise. */
export function apiFailed(
  context: string,
  err: unknown,
  failure: string,
  refusal: (err: unknown) => string | null = refusalMessage,
): void {
  reportError(context, err)
  notify.error(refusal(err) ?? failure)
}

export interface SaveOnChange<T> {
  (value: T): void
  /** Resolves once every queued save has settled. */
  settled(): Promise<void>
}

/**
 * Saves each change in order, one at a time (settings autosave, no Save button). A failure is
 * reported, `failed` restores the server values, an error toast says `failure`, and the changes
 * queued before the failure are dropped; a change made after it is saved normally.
 */
export function saveOnChange<T, R>(
  save: (value: T) => Promise<R>,
  {
    failure,
    saved,
    failed,
  }: {
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
        reportError('[saveOnChange] a save failed', err)
        failed?.(err)
        notify.error(typeof failure === 'string' ? failure : failure())
      }
    })
  }
  return Object.assign(change, { settled: () => queue })
}
