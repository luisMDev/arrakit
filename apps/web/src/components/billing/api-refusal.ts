import { fallbackORPCErrorMessage } from '@orpc/client'

import { statusOf } from '#/lib/api-errors'

const REFUSALS = new Set([400, 402, 403, 409])

export function billingRefusal(err: unknown): string | null {
  if (!REFUSALS.has(statusOf(err))) return null
  if (!err || typeof err !== 'object' || !('message' in err)) return null
  const { message } = err
  if (typeof message !== 'string' || message.trim() === '') return null
  if (message === 'Input validation failed') return null
  const code = 'code' in err && typeof err.code === 'string' ? err.code : null
  if (code && message === fallbackORPCErrorMessage(code, undefined)) return null
  return message
}
