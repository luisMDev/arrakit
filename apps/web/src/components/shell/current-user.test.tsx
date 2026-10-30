import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { initialOf, roleFlags, useCurrentUser } from '#/lib/current-user'
import { orpc } from '#/lib/orpc'
import { testQueryClient, withQueries } from '#/test/rpc'

import { meAs } from './testing'

describe('roleFlags', () => {
  it.each([
    ['owner', true, true],
    ['admin', true, false],
    ['member', false, false],
    [null, false, false],
  ] as const)('%s: isAdmin %s, isOwner %s', (role, isAdmin, isOwner) => {
    expect(roleFlags(role)).toEqual({ isAdmin, isOwner })
  })
})

describe('initialOf', () => {
  it('takes the first letter, uppercased', () => {
    expect(initialOf(' ana ruiz')).toBe('A')
    expect(initialOf('')).toBe('')
  })
})

describe('useCurrentUser', () => {
  function setUp(seed?: ReturnType<typeof meAs>) {
    const queryClient = testQueryClient()
    if (seed) queryClient.setQueryData(orpc.me.get.queryOptions().queryKey, seed)
    return {
      ...renderHook(() => useCurrentUser(), { wrapper: withQueries(queryClient) }),
      queryClient,
    }
  }

  it('is no one, and neither admin nor owner, before anyone signs in', () => {
    const { result } = setUp()
    expect(result.current.user).toBeNull()
    expect(result.current.isAdmin).toBe(false)
    expect(result.current.isOwner).toBe(false)
    expect(result.current.planLabel).toBe('')
  })

  it('names the plan and follows a patch with no refetch', async () => {
    const { result } = setUp(meAs())
    expect(result.current.planLabel).toBe('Pro')
    act(() => result.current.patch((me) => ({ ...me, name: 'Ana María' })))
    await waitFor(() => expect(result.current.name).toBe('Ana María'))
  })

  it('forgets the person on sign out', () => {
    const { result, queryClient } = setUp(meAs())
    act(() => result.current.signedOut())
    expect(queryClient.getQueryData(orpc.me.get.queryOptions().queryKey)).toBeUndefined()
  })
})
