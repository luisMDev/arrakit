import { describe, expect, it } from 'vitest'

import { type MemberChange, memberChangeRefusal } from './organization-policy'

const custom = {
  finance: { billing: ['read', 'manage'] as const },
  boss: { organization: ['delete'] as const },
}

const change = (
  actorRole: string,
  rest: Partial<Omit<MemberChange, 'actorRole' | 'custom'>> = {},
): MemberChange => ({ actorRole, self: false, custom, ...rest })

const invite = (actorRole: string, newRole: string) => change(actorRole, { newRole })
const setRole = (actorRole: string, targetRole: string, newRole: string, self = false) =>
  change(actorRole, { targetRole, newRole, self })
const remove = (actorRole: string, targetRole: string, self = false) =>
  change(actorRole, { targetRole, self })

describe('memberChangeRefusal', () => {
  it.each<[string, MemberChange]>([
    ['the owner invites a member', invite('owner', 'member')],
    ['the owner invites an admin', invite('owner', 'admin')],
    ['an admin invites a member', invite('admin', 'member')],
    ['an admin invites with a custom role within their rights', invite('admin', 'finance')],
    ['the owner promotes a member to admin', setRole('owner', 'member', 'admin')],
    ['the owner gives a role with more rights than an admin', setRole('owner', 'member', 'boss')],
    ['the owner demotes an admin', setRole('owner', 'admin', 'member')],
    ['the owner removes an admin', remove('owner', 'admin')],
    ['an admin removes a member', remove('admin', 'member')],
    ['an admin steps down', setRole('admin', 'admin', 'member', true)],
    ['an admin leaves', remove('admin', 'admin', true)],
  ])('allows: %s', (_label, input) => {
    expect(memberChangeRefusal(input)).toBeNull()
  })

  it.each<[string, MemberChange, RegExp]>([
    ['an admin invites an admin', invite('admin', 'admin'), /Only the owner names admins/],
    ['an admin promotes a member to admin', setRole('admin', 'member', 'admin'), /Only the owner/],
    ['an admin demotes another admin', setRole('admin', 'admin', 'member'), /Only the owner/],
    ['an admin removes another admin', remove('admin', 'admin'), /Only the owner/],
    ['an admin removes the owner', remove('admin', 'owner'), /owner's role or seat/],
    ["an admin changes the owner's role", setRole('admin', 'owner', 'member'), /owner/],
    ['the owner demotes themselves', setRole('owner', 'owner', 'admin', true), /only owner/],
    ['the owner removes themselves', remove('owner', 'owner', true), /only owner/],
    ['the owner invites an owner', invite('owner', 'owner'), /No one is made owner/],
    ['the owner makes a member owner', setRole('owner', 'member', 'member,owner'), /owner/],
    [
      'an admin gives a role above their own',
      setRole('admin', 'member', 'boss'),
      /permissions you don't have/,
    ],
    [
      'an admin invites with a role above their own',
      invite('admin', 'boss'),
      /permissions you don't have/,
    ],
    ['an admin removes someone above them', remove('admin', 'boss'), /more rights/],
  ])('refuses: %s', (_label, input, reason) => {
    expect(memberChangeRefusal(input)).toMatch(reason)
  })
})
