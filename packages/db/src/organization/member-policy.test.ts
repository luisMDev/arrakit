import { describe, expect, it } from 'vitest'
import { MemberChangeRefusedError } from '../errors'
import { type MemberChange, type MemberChangeInput, requireMemberChange } from './members'

const ORGANIZATION = '0b6f1c3e-8d4a-4f7e-9a51-2c3d4e5f6a7b'
const OTHER_ORGANIZATION = '7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6'

const owner = { userId: 'owner', organizationId: ORGANIZATION, role: 'owner' }
const admin = { userId: 'admin', organizationId: ORGANIZATION, role: 'admin' }
const otherAdmin = { userId: 'admin-2', organizationId: ORGANIZATION, role: 'admin' }
const member = { userId: 'member', organizationId: ORGANIZATION, role: 'member' }

const input = (
  actor: MemberChangeInput['actor'],
  change: MemberChange,
  counts: { owners?: number; admins?: number } = {},
): MemberChangeInput => ({ actor, change, owners: counts.owners ?? 1, admins: counts.admins ?? 1 })

const invite = (role: string): MemberChange => ({
  kind: 'invite',
  organizationId: ORGANIZATION,
  role,
})
const setRole = (target: MemberChangeInput['actor'], role: string): MemberChange => ({
  kind: 'role',
  target,
  role,
})
const remove = (target: MemberChangeInput['actor']): MemberChange => ({ kind: 'remove', target })

describe('requireMemberChange', () => {
  it.each<[string, MemberChangeInput]>([
    ['the owner invites a member', input(owner, invite('member'))],
    ['the owner invites an admin', input(owner, invite('admin'))],
    ['an admin invites a member', input(admin, invite('member'))],
    ['an admin invites an admin', input(admin, invite('admin'))],
    ['the owner promotes a member to admin', input(owner, setRole(member, 'admin'))],
    ['the owner demotes an admin', input(owner, setRole(admin, 'member'))],
    ['the owner removes an admin', input(owner, remove(admin))],
    ['an admin removes a member', input(admin, remove(member))],
    ['an admin steps down while an owner exists', input(admin, setRole(admin, 'member'))],
    ['an admin leaves while an owner exists', input(admin, remove(admin))],
    [
      'an admin steps down in an ownerless organization with another admin',
      input(admin, setRole(admin, 'member'), { owners: 0, admins: 2 }),
    ],
  ])('allows: %s', (_label, change) => {
    expect(() => requireMemberChange(change)).not.toThrow()
  })

  it.each<[string, MemberChangeInput, RegExp]>([
    ['a member invites a member', input(member, invite('member')), /Only an admin/],
    ['a member removes a member', input(member, remove(member)), /Only an admin/],
    [
      'an admin promotes a member to admin',
      input(admin, setRole(member, 'admin')),
      /Only the owner/,
    ],
    [
      'an admin demotes another admin',
      input(admin, setRole(otherAdmin, 'member'), { admins: 2 }),
      /Only the owner/,
    ],
    [
      'an admin removes another admin',
      input(admin, remove(otherAdmin), { admins: 2 }),
      /Only the owner/,
    ],
    ['an admin removes the owner', input(admin, remove(owner)), /owner/],
    ["an admin changes the owner's role", input(admin, setRole(owner, 'member')), /owner/],
    [
      'the owner demotes themselves as the sole owner',
      input(owner, setRole(owner, 'admin')),
      /only owner/,
    ],
    ['the owner removes themselves as the sole owner', input(owner, remove(owner)), /only owner/],
    ['the owner invites an owner', input(owner, invite('owner')), /owner/],
    ['the owner makes a member owner', input(owner, setRole(member, 'owner')), /owner/],
    ['the owner invites as "Admin"', input(owner, invite('Admin')), /role/],
    ['the owner invites as "superadmin"', input(owner, invite('superadmin')), /role/],
    ['the owner assigns "superadmin"', input(owner, setRole(member, 'superadmin')), /role/],
    [
      'an actor from another organization removes a member',
      input({ ...owner, organizationId: OTHER_ORGANIZATION }, remove(member)),
      /organization/,
    ],
    [
      'an actor from another organization invites',
      input({ ...owner, organizationId: OTHER_ORGANIZATION }, invite('member')),
      /organization/,
    ],
    [
      'the last admin of an ownerless organization steps down',
      input(admin, setRole(admin, 'member'), { owners: 0, admins: 1 }),
      /last admin/,
    ],
    [
      'the last admin of an ownerless organization leaves',
      input(admin, remove(admin), { owners: 0, admins: 1 }),
      /last admin/,
    ],
    [
      'an actor whose role is "Admin"',
      input({ ...admin, role: 'Admin' }, remove(member)),
      /Only an admin/,
    ],
  ])('refuses: %s', (_label, change, reason) => {
    expect(() => requireMemberChange(change)).toThrow(MemberChangeRefusedError)
    expect(() => requireMemberChange(change)).toThrow(reason)
  })
})
