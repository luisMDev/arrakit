import { fallbackORPCErrorMessage } from '@orpc/client'

import { statusOf } from '#/lib/api-errors'

/** Statuses whose message is a refusal written for the user. */
const REFUSALS = new Set([400, 402, 403, 409])

/**
 * Checkout and the plan switch also show the API's own words when payments are
 * not set up (503) or Stripe refused the request (502), like saas-base does.
 */
const PAYMENT_REFUSALS = new Set([...REFUSALS, 502, 503])

function ownMessage(err: unknown, statuses: ReadonlySet<number>): string | null {
  if (!statuses.has(statusOf(err))) return null
  if (!err || typeof err !== 'object' || !('message' in err)) return null
  const { message } = err
  if (typeof message !== 'string' || message.trim() === '') return null
  if (message === 'Input validation failed') return null
  const code = 'code' in err && typeof err.code === 'string' ? err.code : null
  if (code && message === fallbackORPCErrorMessage(code, undefined)) return null
  return message
}

/** The API's refusal message (4xx), or null when it has none worth showing. */
export function billingRefusal(err: unknown): string | null {
  return ownMessage(err, REFUSALS)
}

/** Like billingRefusal, but also passes through 502/503 messages (Checkout, plan switch). */
export function paymentRefusal(err: unknown): string | null {
  return ownMessage(err, PAYMENT_REFUSALS)
}
