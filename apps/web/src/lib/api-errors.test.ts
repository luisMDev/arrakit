import { ORPCError } from '@orpc/client'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiCall, refusalMessage, saveOnChange } from './api-errors'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

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

describe('apiCall', () => {
  it('passes the value on', async () => {
    const next = vi.fn()
    expect(await apiCall(Promise.resolve(3), 'Failed', { next })).toBe(3)
    expect(next).toHaveBeenCalledWith(3)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("toasts the API's refusal, after putting the control back", async () => {
    const failed = vi.fn()
    const err = new ORPCError('BAD_REQUEST', { message: 'Pick another name.' })
    expect(await apiCall(Promise.reject(err), 'Failed', { failed })).toBeUndefined()
    expect(failed).toHaveBeenCalledWith(err)
    expect(console.error).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      'Pick another name.',
      expect.objectContaining({ id: 'error:Pick another name.', duration: 6000 }),
    )
  })

  it('toasts the fallback for a 5xx or no answer', async () => {
    await apiCall(() => Promise.reject(new ORPCError('INTERNAL_SERVER_ERROR')), 'Failed')
    await apiCall(
      () => Promise.reject(new TypeError('offline')),
      (e) => `Failed: ${String(e)}`,
    )
    expect(vi.mocked(toast.error).mock.calls.map(([m]) => m)).toEqual([
      'Failed',
      'Failed: TypeError: offline',
    ])
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
