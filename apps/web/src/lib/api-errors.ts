import { fallbackORPCErrorMessage } from '@orpc/client'
import { toast } from 'sonner'

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

/**
 * The API's own reason when it refused a request on its merits (400 or 403 with a message);
 * `null` for anything else (5xx, no answer, a generic message).
 */
export function refusalMessage(err: unknown): string | null {
  const status = statusOf(err)
  return status === 400 || status === 403 ? ownMessage(err) : null
}

export type ApiFailure = string | ((err: unknown) => string)

const failureText = (failure: ApiFailure, err: unknown): string =>
  typeof failure === 'string' ? failure : failure(err)

/** An error toast; the same text never stacks, showing it again restarts its timer. */
export function toastError(message: string): void {
  toast.error(message, { id: `error:${message}`, duration: 6000 })
}

/** An info toast (3 s); the same text never stacks. */
export function toastInfo(message: string): void {
  toast(message, { id: `info:${message}`, duration: 3000 })
}

export interface ApiCallOptions<T> {
  next?: (value: T) => void
  failed?: (err: unknown) => void
}

/**
 * Runs an API call for a screen. A failure is reported, `failed` runs (to put a control back),
 * and an error toast says the API's refusal message or `failure` otherwise.
 * Resolves to the value, or `undefined` when the call failed.
 */
export async function apiCall<T>(
  call: Promise<T> | (() => Promise<T>),
  failure: ApiFailure,
  { next, failed }: ApiCallOptions<T> = {},
): Promise<T | undefined> {
  try {
    const value = await (typeof call === 'function' ? call() : call)
    next?.(value)
    return value
  } catch (err) {
    reportError('[apiCall] a call failed', err)
    failed?.(err)
    toastError(refusalMessage(err) ?? failureText(failure, err))
    return undefined
  }
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
  }: { failure: ApiFailure; saved?: (result: R) => void; failed?: (err: unknown) => void },
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
        toastError(failureText(failure, err))
      }
    })
  }
  return Object.assign(change, { settled: () => queue })
}
