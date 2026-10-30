import { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { displayName, initialOf, roleFlags, useCurrentUser } from '#/lib/current-user'
import { orpc } from '#/lib/orpc'
import { withQueries } from '#/test/rpc'

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

describe('displayName and initialOf', () => {
  it('uses the trimmed name, else the email local part', () => {
    expect(displayName({ name: ' Ana Ruiz ', email: 'ana@acme.com' })).toBe('Ana Ruiz')
    expect(displayName({ name: '  ', email: 'ana@acme.com' })).toBe('ana')
  })

  it('takes the first letter, uppercased', () => {
    expect(initialOf(' ana ruiz')).toBe('A')
    expect(initialOf('')).toBe('')
  })
})

describe('useCurrentUser', () => {
  function setUp(seed?: ReturnType<typeof meAs>) {
    const queryClient = new QueryClient()
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
