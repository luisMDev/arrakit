import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { initialOf, useCurrentUser } from '#/lib/current-user'
import { orpc } from '#/lib/orpc'
import { meAs, testQueryClient } from '#/test/rpc'

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
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    return { ...renderHook(() => useCurrentUser(), { wrapper }), queryClient }
  }

  it('is no one, and neither admin nor owner, before anyone signs in', () => {
    const { result } = setUp()
    expect(result.current.user).toBeNull()
    expect(result.current.can({ usage: ['read'] })).toBe(false)
    expect(result.current.isOwner).toBe(false)
  })

  it.each([
    ['owner', true, true, true],
    ['admin', false, true, true],
    ['member', false, false, false],
  ] as const)(
    '%s: owner %s, manages members %s, manages billing %s',
    (role, isOwner, managesMembers, managesBilling) => {
      const { result } = setUp(meAs({ role }))
      expect(result.current).toMatchObject({ isOwner, managesMembers, managesBilling })
    },
  )

  it('reads a custom role from its permissions', () => {
    const { result } = setUp(meAs({ role: 'finance', permissions: { billing: ['read'] } }))
    expect(result.current.can({ billing: ['read'] })).toBe(true)
    expect(result.current.can({ billing: ['read', 'manage'] })).toBe(false)
    expect(result.current).toMatchObject({
      isOwner: false,
      managesMembers: false,
      managesBilling: false,
    })
  })

  it('follows a patch with no refetch', async () => {
    const { result } = setUp(meAs())
    act(() => result.current.patch((me) => ({ ...me, name: 'Ana María' })))
    await waitFor(() => expect(result.current.name).toBe('Ana María'))
  })

  it('forgets the person on sign out', () => {
    const { result, queryClient } = setUp(meAs())
    act(() => result.current.signedOut())
    expect(queryClient.getQueryData(orpc.me.get.queryOptions().queryKey)).toBeUndefined()
  })
})
