import { describe, expect, it } from 'vitest'

import { allows, isOwnerRole, parsePermissions, permissionsOf, roles } from './permissions'

describe('permissions', () => {
  it('gives the owner everything, the admin all but deleting the organization', () => {
    expect(allows(permissionsOf('owner'), { organization: ['delete'], ac: ['create'] })).toBe(true)
    const admin = permissionsOf('admin')
    expect(
      allows(admin, { member: ['update'], billing: ['manage'], ac: ['create', 'delete'] }),
    ).toBe(true)
    expect(allows(admin, { organization: ['delete'] })).toBe(false)
  })

  it('lets a member read usage and roles only', () => {
    const member = permissionsOf('member')
    expect(allows(member, { usage: ['read'], ac: ['read'] })).toBe(true)
    expect(allows(member, { billing: ['read'] })).toBe(false)
    expect(allows(member, { invitation: ['create'] })).toBe(false)
  })

  it('joins several roles and custom ones; unknown roles grant nothing', () => {
    const custom = { finance: { billing: ['read'] as const } }
    expect(permissionsOf('member,finance', custom)).toEqual({
      ac: ['read'],
      usage: ['read'],
      billing: ['read'],
    })
    expect(permissionsOf('superadmin')).toEqual({})
    expect(permissionsOf('Admin')).toEqual({})
  })

  it('wants every action named', () => {
    expect(allows({ billing: ['read'] }, { billing: ['read', 'manage'] })).toBe(false)
    expect(allows({ billing: ['read'] }, {})).toBe(true)
  })

  it('matches the roles Better Auth checks', () => {
    expect(roles.admin.authorize({ billing: ['manage'] }).success).toBe(true)
    expect(roles.member.authorize({ billing: ['read'] }).success).toBe(false)
  })

  it('reads the owner out of a role string', () => {
    expect(isOwnerRole('owner')).toBe(true)
    expect(isOwnerRole('admin, owner')).toBe(true)
    expect(isOwnerRole('owners')).toBe(false)
  })

  it('reads a stored custom role, dropping what it does not know', () => {
    expect(
      parsePermissions('{"billing":["read","steal"],"vault":["open"],"usage":"read"}'),
    ).toEqual({
      billing: ['read'],
    })
    expect(parsePermissions('not json')).toEqual({})
    expect(parsePermissions('null')).toEqual({})
  })
})
