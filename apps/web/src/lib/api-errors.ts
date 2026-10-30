import { fallbackORPCErrorMessage } from '@orpc/client'

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
