import { ORPCError } from '@orpc/client'
import { describe, expect, it } from 'vitest'

import { apiMessage } from './api-errors'

const refused = (code: string, status: number, message?: string) =>
  new ORPCError(code, { status, message })

describe('apiMessage', () => {
  it.each([
    ['BAD_REQUEST', 400],
    ['PAYMENT_REQUIRED', 402],
    ['FORBIDDEN', 403],
    ['CONFLICT', 409],
    ['BAD_GATEWAY', 502],
    ['SERVICE_UNAVAILABLE', 503],
  ])('says the message the API gave a %s', (code, status) => {
    expect(apiMessage(refused(code, status, 'Payments are not set up yet.'))).toBe(
      'Payments are not set up yet.',
    )
  })

  it.each([
    ['a 500', refused('INTERNAL_SERVER_ERROR', 500, 'db down')],
    ['no answer', new TypeError('Failed to fetch')],
    ['a non-API error', new Error('Stripe.js did not load')],
    ['nothing', null],
    ["oRPC's fallback text", refused('BAD_GATEWAY', 502)],
    ['a 404 with no message', refused('NOT_FOUND', 404)],
    ['a validation failure', refused('BAD_REQUEST', 400, 'Input validation failed')],
    ['a blank message', refused('FORBIDDEN', 403, '  ')],
  ])('has none for %s', (_, err) => {
    expect(apiMessage(err)).toBeNull()
  })
})
