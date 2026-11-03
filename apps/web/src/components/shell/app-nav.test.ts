import { describe, expect, it } from 'vitest'

import { accessOf } from '#/lib/current-user'
import { meAs } from '#/test/rpc'

import { APP_NAV, navFor } from './app-nav'

const labels = (items: readonly { label: string }[]) => items.map((item) => item.label)

describe('app navigation', () => {
  it('shows each role the destinations its permissions open', () => {
    expect(labels(navFor(accessOf(meAs({ role: 'owner' }))))).toEqual(labels(APP_NAV))
    expect(labels(navFor(accessOf(meAs({ role: 'member' }))))).toEqual([
      'home',
      'workspaces',
      'settings',
    ])
    expect(labels(navFor(accessOf(meAs({ role: 'nobody', permissions: {} }))))).toEqual([
      'home',
      'settings',
    ])
  })
})
