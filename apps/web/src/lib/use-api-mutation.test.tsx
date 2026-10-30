import { ORPCError } from '@orpc/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiMessage } from './api-errors'
import { useApiMutation } from './use-api-mutation'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const toasts = () => vi.mocked(toast.error).mock.calls.map(([message]) => message)

describe('useApiMutation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.clearAllMocks())

  it('passes the value on', async () => {
    const onSuccess = vi.fn()
    const { result } = renderHook(
      () =>
        useApiMutation(
          { mutationFn: (n: number) => Promise.resolve(n * 3), onSuccess },
          { context: '[test] failed', failure: 'Failed' },
        ),
      { wrapper },
    )
    let value: number | undefined
    await act(async () => {
      value = await result.current.run(1)
    })
    expect(value).toBe(3)
    expect(onSuccess).toHaveBeenCalledWith(3, 1, undefined, expect.anything())
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("toasts the API's refusal, then runs the caller's onError", async () => {
    const err = new ORPCError('BAD_REQUEST', { message: 'Pick another name.' })
    const onError = vi.fn()
    const { result } = renderHook(
      () =>
        useApiMutation(
          { mutationFn: () => Promise.reject(err), onError },
          { context: '[test] failed', failure: 'Failed' },
        ),
      { wrapper },
    )
    let value: unknown = 'unset'
    await act(async () => {
      value = await result.current.run()
    })
    expect(value).toBeUndefined()
    expect(onError).toHaveBeenCalledWith(err, undefined, undefined, expect.anything())
    expect(console.error).toHaveBeenCalledWith('[test] failed', err)
    expect(toast.error).toHaveBeenCalledWith(
      'Pick another name.',
      expect.objectContaining({ id: 'error:Pick another name.', duration: 6000 }),
    )
  })

  it('toasts the fallback for a 5xx or no answer, built from the variables', async () => {
    const failures = [new ORPCError('INTERNAL_SERVER_ERROR'), new TypeError('offline')]
    const { result } = renderHook(
      () =>
        useApiMutation(
          { mutationFn: (_email: string) => Promise.reject(failures.shift()) },
          { context: '[test] failed', failure: (email) => `${email} not invited` },
        ),
      { wrapper },
    )
    await act(async () => {
      await result.current.run('ana@acme.com')
      await result.current.run('bo@acme.com')
    })
    expect(toasts()).toEqual(['ana@acme.com not invited', 'bo@acme.com not invited'])
  })

  it('uses the given refusal reader', async () => {
    const err = new ORPCError('CONFLICT', { status: 409, message: 'Already a member.' })
    const { result } = renderHook(
      () =>
        useApiMutation(
          { mutationFn: () => Promise.reject(err) },
          { context: '[test] failed', failure: 'Failed', refusal: apiMessage },
        ),
      { wrapper },
    )
    await act(async () => {
      await result.current.run()
    })
    expect(toasts()).toEqual(['Already a member.'])
  })

  it('sends one request for a double run', async () => {
    const pending: (() => void)[] = []
    const mutationFn = vi.fn(() => new Promise<void>((resolve) => pending.push(resolve)))
    const { result } = renderHook(
      () => useApiMutation({ mutationFn }, { context: '[test] failed', failure: 'Failed' }),
      { wrapper },
    )
    let first: Promise<void | undefined> = Promise.resolve()
    let second: Promise<void | undefined> = Promise.resolve()
    act(() => {
      first = result.current.run()
      second = result.current.run()
    })
    expect(await second).toBeUndefined()
    await waitFor(() => expect(pending).toHaveLength(1))
    await act(async () => {
      pending.shift()?.()
      await first
    })
    expect(mutationFn).toHaveBeenCalledTimes(1)

    let again: Promise<void | undefined> = Promise.resolve()
    act(() => {
      again = result.current.run()
    })
    await waitFor(() => expect(pending).toHaveLength(1))
    await act(async () => {
      pending.shift()?.()
      await again
    })
    expect(mutationFn).toHaveBeenCalledTimes(2)
  })
})
