import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { accessOf, initialOf, useCurrentUser } from '#/lib/current-user'
import { orpc } from '#/lib/orpc'
import { meAs, testQueryClient, withQueries } from '#/test/rpc'

describe('accessOf', () => {
  it.each([
    ['owner', true, true, true],
    ['admin', false, true, true],
    ['member', false, false, false],
  ] as const)(
    '%s: owner %s, manages members %s, manages billing %s',
    (role, isOwner, managesMembers, managesBilling) => {
      expect(accessOf(meAs({ role }))).toMatchObject({ isOwner, managesMembers, managesBilling })
    },
  )

  it('reads a custom role from its permissions', () => {
    const access = accessOf(meAs({ role: 'finance', permissions: { billing: ['read'] } }))
    expect(access.can({ billing: ['read'] })).toBe(true)
    expect(access.can({ billing: ['read', 'manage'] })).toBe(false)
    expect(access).toMatchObject({ isOwner: false, managesMembers: false, managesBilling: false })
  })

  it('grants nothing to no one', () => {
    expect(accessOf(null).can({})).toBe(false)
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
    expect(result.current.can({ usage: ['read'] })).toBe(false)
    expect(result.current.isOwner).toBe(false)
    expect(result.current.planLabel).toBe('')
  })

  it('names the plan and follows a patch with no refetch', async () => {
    const { result } = setUp(meAs())
    expect(result.current.planLabel).toBe('Team')
    act(() => result.current.patch((me) => ({ ...me, name: 'Ana María' })))
    await waitFor(() => expect(result.current.name).toBe('Ana María'))
  })

  it('forgets the person on sign out', () => {
    const { result, queryClient } = setUp(meAs())
    act(() => result.current.signedOut())
    expect(queryClient.getQueryData(orpc.me.get.queryOptions().queryKey)).toBeUndefined()
  })
})
