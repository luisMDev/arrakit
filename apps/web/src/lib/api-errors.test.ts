import { ORPCError } from '@orpc/client'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiMessage, saveOnChange } from './api-errors'

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

describe('saveOnChange', () => {
  it('saves each change in order, one at a time', async () => {
    const answers = [deferred<string>(), deferred<string>()]
    const save = vi.fn((value: string) =>
      answers[save.mock.calls.length - 1]!.promise.then(() => value),
    )
    const saved = vi.fn()
    const change = saveOnChange(save, {
      context: '[test] save failed',
      failure: 'Not saved',
      saved,
    })
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
    const change = saveOnChange(save, {
      context: '[test] save failed',
      failure: 'Not saved',
      failed,
    })
    change('a')
    change('b')
    first.reject(new Error('boom'))
    await change.settled()
    expect(save.mock.calls).toEqual([['a']])
    expect(failed).toHaveBeenCalledOnce()
    expect(console.error).toHaveBeenCalledWith('[test] save failed', expect.any(Error))
    expect(toast.error).toHaveBeenCalledWith('Not saved', expect.anything())

    change('c')
    await change.settled()
    expect(save.mock.calls).toEqual([['a'], ['c']])
  })
})
