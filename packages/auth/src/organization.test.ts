import { describe, expect, it, vi } from 'vitest'

import type { AuthDeps } from './auth'
import { loadAuthConfig } from './config'
import { organizationPlugin } from './organization'
import { testOrganizationDeps } from './test-deps'

const config = loadAuthConfig({
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:5200',
})

function hooksWith(membershipIn: AuthDeps['data']['membershipIn']) {
  const data = {
    membershipIn,
    customRoles: async () => [],
    asSystem: () => ({ members: { seatsTaken: async () => 0 } }),
  } as unknown as AuthDeps['data']
  const deps = { config, data, organizations: testOrganizationDeps } as unknown as AuthDeps
  return organizationPlugin(deps).options.organizationHooks!
}

const organization = { id: 'org-1', name: 'Oak', slug: 'oak', createdAt: new Date() }
const member = {
  id: 'm-2',
  userId: 'u-2',
  organizationId: 'org-1',
  role: 'member',
  createdAt: new Date(),
}
const user = { id: 'u-2', email: 'b@oak.vc', name: '', emailVerified: true }
const UNKNOWN = { message: "You can't change this organization's members." }

describe('member rules in the organization hooks', () => {
  it('refuses a removal or role change made outside a request', async () => {
    const membershipIn = vi.fn()
    const hooks = hooksWith(membershipIn)
    const at = { member, user, organization } as never
    await expect(hooks.beforeRemoveMember!(at)).rejects.toMatchObject(UNKNOWN)
    await expect(
      hooks.beforeUpdateMemberRole!({ member, user, organization, newRole: 'admin' } as never),
    ).rejects.toMatchObject(UNKNOWN)
    expect(membershipIn).not.toHaveBeenCalled()
  })

  it('refuses an invite from someone who is not a member', async () => {
    const hooks = hooksWith(async () => null)
    await expect(
      hooks.beforeCreateInvitation!({
        invitation: {
          email: 'c@oak.vc',
          role: 'member',
          organizationId: 'org-1',
          inviterId: 'u-9',
        },
        inviter: { ...user, id: 'u-9' },
        organization,
      } as never),
    ).rejects.toMatchObject(UNKNOWN)
  })

  it("applies the organization's rules to an invite", async () => {
    const hooks = hooksWith(async () => ({ role: 'admin' }) as never)
    const invite = (role: string) =>
      hooks.beforeCreateInvitation!({
        invitation: { email: 'c@oak.vc', role, organizationId: 'org-1', inviterId: 'u-1' },
        inviter: { ...user, id: 'u-1' },
        organization: { ...organization, plan: 'team' },
      } as never)
    await expect(invite('admin')).rejects.toMatchObject({ message: 'Only the owner names admins.' })
    await expect(invite('member')).resolves.toBeUndefined()
  })
})
