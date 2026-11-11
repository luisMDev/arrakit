import { describe, expect, it } from 'vitest'

import { accessOf } from '#/lib/current-user'
import { meAs } from '#/test/rpc'

import { ORGANIZATION_NAV, navFor, workspaceNav } from './app-nav'

const labels = (items: readonly { label: string }[]) => items.map((item) => item.label)
const as = (me: Parameters<typeof meAs>[0]) => accessOf(meAs(me))
const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const WORKSPACE = workspaceNav(ID)

describe('app navigation', () => {
  it('shows everyone Home outside a workspace', () => {
    expect(labels(navFor(as({ role: 'owner' })))).toEqual(['home'])
    expect(labels(navFor(as({ role: 'nobody', permissions: {} })))).toEqual(['home'])
    expect(navFor(as({ role: 'owner' }))[0]!.link).toMatchObject({ to: '/app' })
  })

  it("shows the workspace's own Home and Tasks and, for a role that reads files, its Library", () => {
    expect(labels(navFor(as({ role: 'member' }), WORKSPACE))).toEqual(['home', 'library', 'tasks'])
    expect(
      labels(navFor(as({ role: 'viewer', permissions: { workspace: ['read'] } }), WORKSPACE)),
    ).toEqual(['home', 'tasks'])
    expect(WORKSPACE.map((item) => item.link)).toMatchObject([
      { to: '/app/workspaces/$workspaceId', params: { workspaceId: ID } },
      { to: '/app/workspaces/$workspaceId/library', params: { workspaceId: ID } },
      { to: '/app/workspaces/$workspaceId/tasks', params: { workspaceId: ID } },
    ])
  })

  it("keeps the organization's destinations for the menu, by role", () => {
    expect(labels(navFor(as({ role: 'owner' }), ORGANIZATION_NAV))).toEqual([
      'settings',
      'members',
      'billing',
    ])
    expect(labels(navFor(as({ role: 'member' }), ORGANIZATION_NAV))).toEqual(['settings'])
    expect(
      labels(navFor(as({ role: 'finance', permissions: { billing: ['read'] } }), ORGANIZATION_NAV)),
    ).toEqual(['settings', 'billing'])
  })
})
