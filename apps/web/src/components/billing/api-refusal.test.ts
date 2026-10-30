import { ORPCError } from '@orpc/client'
import { describe, expect, it } from 'vitest'

import { billingRefusal, paymentRefusal } from './api-refusal'

const refused = (code: string, status: number, message?: string) =>
  new ORPCError(code, { status, message })

describe('billingRefusal', () => {
  it.each([
    ['BAD_REQUEST', 400],
    ['PAYMENT_REQUIRED', 402],
    ['FORBIDDEN', 403],
    ['CONFLICT', 409],
  ])('passes through a %s refusal', (code, status) => {
    expect(billingRefusal(refused(code, status, 'Your card was declined.'))).toBe(
      'Your card was declined.',
    )
  })

  it.each([
    ['BAD_GATEWAY', 502],
    ['SERVICE_UNAVAILABLE', 503],
    ['INTERNAL_SERVER_ERROR', 500],
  ])('keeps its own text for a %s', (code, status) => {
    expect(billingRefusal(refused(code, status, 'Payments are not set up yet.'))).toBeNull()
  })
})

describe('paymentRefusal', () => {
  it.each([
    ['CONFLICT', 409],
    ['BAD_GATEWAY', 502],
    ['SERVICE_UNAVAILABLE', 503],
  ])('passes through a %s message', (code, status) => {
    expect(paymentRefusal(refused(code, status, 'Payments are not set up yet.'))).toBe(
      'Payments are not set up yet.',
    )
  })

  it('ignores a 500', () => {
    expect(paymentRefusal(refused('INTERNAL_SERVER_ERROR', 500, 'boom'))).toBeNull()
  })

  it('ignores the generic text oRPC sends when there is no message', () => {
    expect(paymentRefusal(refused('BAD_GATEWAY', 502))).toBeNull()
    expect(paymentRefusal(refused('SERVICE_UNAVAILABLE', 503))).toBeNull()
  })

  it('ignores validation failures and non-API errors', () => {
    expect(paymentRefusal(refused('BAD_REQUEST', 400, 'Input validation failed'))).toBeNull()
    expect(paymentRefusal(new Error('Stripe.js did not load'))).toBeNull()
    expect(paymentRefusal(null)).toBeNull()
  })
})
