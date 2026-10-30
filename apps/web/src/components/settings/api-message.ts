import { fallbackORPCErrorMessage } from '@orpc/client'

import { statusOf } from '#/lib/api-errors'

const GENERIC = new Set(['Input validation failed'])

/** The API's own message for an error answered with a status in `range`, else null. */
export function apiMessage(
  err: unknown,
  range: (status: number) => boolean = is4xx,
): string | null {
  if (!range(statusOf(err)) || !err || typeof err !== 'object' || !('message' in err)) return null
  const { message } = err
  if (typeof message !== 'string' || message.trim() === '' || GENERIC.has(message)) return null
  const code = 'code' in err && typeof err.code === 'string' ? err.code : null
  if (code && message === fallbackORPCErrorMessage(code, undefined)) return null
  return message
}

export const is4xx = (status: number) => status >= 400 && status < 500
export const isError = (status: number) => status >= 400
