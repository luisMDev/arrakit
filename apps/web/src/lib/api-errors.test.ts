import { ORPCError } from '@orpc/client'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiMessage, paymentRefusal, refusalMessage, saveOnChange } from './api-errors'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.clearAllMocks())

describe('refusalMessage', () => {
  it.each([
    [new ORPCError('BAD_REQUEST', { message: 'Pick another name.' }), 'Pick another name.'],
    [new ORPCError('FORBIDDEN', { message: 'Only admins can invite.' }), 'Only admins can invite.'],
  ])('says the API reason for a refusal', (err, message) => {
    expect(refusalMessage(err)).toBe(message)
  })

  it.each([
    ['a 5xx', new ORPCError('INTERNAL_SERVER_ERROR', { message: 'db down' })],
    ['no answer', new TypeError('Failed to fetch')],
    ['a 400 with no message', new ORPCError('BAD_REQUEST')],
    ['a validation failure', new ORPCError('BAD_REQUEST', { message: 'Input validation failed' })],
    ['a 403 with a blank message', new ORPCError('FORBIDDEN', { message: '  ' })],
  ])('has none for %s', (_, err) => {
    expect(refusalMessage(err)).toBeNull()
  })
})

const refused = (code: string, status: number, message?: string) =>
  new ORPCError(code, { status, message })

describe('paymentRefusal', () => {
  it.each([
    ['BAD_REQUEST', 400],
    ['PAYMENT_REQUIRED', 402],
    ['FORBIDDEN', 403],
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

describe('apiMessage', () => {
  it('says the message of any 4xx by default', () => {
    expect(apiMessage(refused('CONFLICT', 409, 'Leave your organizations first.'))).toBe(
      'Leave your organizations first.',
    )
    expect(apiMessage(refused('INTERNAL_SERVER_ERROR', 500, 'db down'))).toBeNull()
  })

  it('takes the statuses it is given', () => {
    expect(
      apiMessage(refused('SERVICE_UNAVAILABLE', 503, 'Try later.'), (status) => status >= 400),
    ).toBe('Try later.')
  })

  it('ignores the generic text oRPC sends when there is no message', () => {
    expect(apiMessage(refused('NOT_FOUND', 404))).toBeNull()
  })
})

describe('saveOnChange', () => {
  it('saves each change in order, one at a time', async () => {
    const answers = [deferred<string>(), deferred<string>()]
    const save = vi.fn((value: string) =>
      answers[save.mock.calls.length - 1]!.promise.then(() => value),
    )
    const saved = vi.fn()
    const change = saveOnChange(save, { failure: 'Not saved', saved })
    change('a')
    change('b')
    await Promise.resolve()
    expect(save).toHaveBeenCalledTimes(1)
    answers[0]!.resolve('')
    answers[1]!.resolve('')
    await change.settled()
    expect(save.mock.calls).toEqual([['a'], ['b']])
    expect(saved.mock.calls).toEqual([['a'], ['b']])
  })

  it('drops the changes queued before a failure and saves the ones after it', async () => {
    const first = deferred<void>()
    const save = vi.fn((value: string) => (value === 'a' ? first.promise : Promise.resolve()))
    const failed = vi.fn()
    const change = saveOnChange(save, { failure: 'Not saved', failed })
    change('a')
    change('b')
    first.reject(new Error('boom'))
    await change.settled()
    expect(save.mock.calls).toEqual([['a']])
    expect(failed).toHaveBeenCalledOnce()
    expect(toast.error).toHaveBeenCalledWith('Not saved', expect.anything())

    change('c')
    await change.settled()
    expect(save.mock.calls).toEqual([['a'], ['c']])
  })
})
