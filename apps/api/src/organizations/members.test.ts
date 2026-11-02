import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { type TestApp, createTestApp } from '../testing/app'
import { joined, orgApi, ownerOf, sqlOf } from '../testing/people'

describe('members (Better Auth organization plugin)', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())
  afterEach(() => vi.restoreAllMocks())

  async function team(tag: string) {
    const owner = await ownerOf(t, `owner@${tag}.vc`)
    const admin = await joined(t, owner, `admin@${tag}.vc`, 'admin')
    const other = await joined(t, owner, `other@${tag}.vc`, 'admin')
    const member = await joined(t, owner, `member@${tag}.vc`)
    const { rows } = await sqlOf(t)(
      `select id from members where organization_id = $1 and role = 'owner'`,
      [owner.organizationId],
    )
    return { owner: { ...owner, memberId: String(rows[0]!.id) }, admin, other, member }
  }

  const setRole = (
    actor: { headers: Headers },
    organizationId: string,
    memberId: string,
    role: string,
  ) => orgApi(t, actor.headers).post('update-member-role', { organizationId, memberId, role })

  const remove = (actor: { headers: Headers }, organizationId: string, memberIdOrEmail: string) =>
    orgApi(t, actor.headers).post('remove-member', { organizationId, memberIdOrEmail })

  const roles = async (organizationId: string) =>
    Object.fromEntries(
      (await t.data.forOrganization(organizationId).members.list()).map((m) => [m.email, m.role]),
    )

  it('lets the owner promote, demote and remove admins', async () => {
    const { owner, admin, member } = await team('alder')
    const org = owner.organizationId
    expect((await setRole(owner, org, member.memberId, 'admin')).status).toBe(200)
    expect((await setRole(owner, org, admin.memberId, 'member')).status).toBe(200)
    expect((await remove(owner, org, 'Admin@Alder.vc')).status).toBe(200)
    expect(await roles(org)).toEqual({
      'owner@alder.vc': 'owner',
      'other@alder.vc': 'admin',
      'member@alder.vc': 'admin',
    })
  })

  it.each([
    ['promote a member to admin', 'member', 'admin', 'Only the owner names admins.'],
    ['demote another admin', 'other', 'member', 'Only the owner demotes or removes an admin.'],
    ["change the owner's role", 'owner', 'member', 'You are not allowed to update this member'],
    ['make someone owner', 'member', 'owner', 'You are not allowed to update this member'],
  ] as const)('refuses an admin who tries to %s', async (_label, target, role, message) => {
    const people = await team(`refuse-${target}-${role}`)
    const answer = await setRole(
      people.admin,
      people.owner.organizationId,
      people[target].memberId,
      role,
    )
    expect(answer).toMatchObject({ status: 403, body: { message } })
  })

  it('lets an admin remove a member and step down, not remove another admin or the owner', async () => {
    const { owner, admin, other, member } = await team('birch')
    const org = owner.organizationId
    expect((await remove(admin, org, other.memberId)).body).toMatchObject({
      message: 'Only the owner demotes or removes an admin.',
    })
    expect((await remove(admin, org, owner.memberId)).body).toMatchObject({
      code: 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER',
    })
    expect((await remove(admin, org, member.memberId)).status).toBe(200)
    expect((await setRole(admin, org, admin.memberId, 'member')).status).toBe(200)
    expect(await roles(org)).toEqual({
      'owner@birch.vc': 'owner',
      'admin@birch.vc': 'member',
      'other@birch.vc': 'admin',
    })
  })

  it('keeps the owner: no demotion, removal or leaving by the only owner', async () => {
    const { owner } = await team('cedar')
    const org = owner.organizationId
    expect((await setRole(owner, org, owner.memberId, 'admin')).body).toMatchObject({
      code: 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER',
    })
    expect((await remove(owner, org, owner.memberId)).body).toMatchObject({
      code: 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER',
    })
    expect((await orgApi(t, owner.headers).post('leave', { organizationId: org })).status).toBe(400)
    expect((await roles(org))['owner@cedar.vc']).toBe('owner')
  })

  it("refuses a member's changes and answers 401 signed out", async () => {
    const { owner, member, other } = await team('elm')
    expect((await setRole(member, owner.organizationId, other.memberId, 'member')).status).toBe(403)
    expect((await remove(member, owner.organizationId, other.memberId)).status).toBe(401)
    expect(
      (await remove({ headers: new Headers() }, owner.organizationId, other.memberId)).status,
    ).toBe(401)
  })

  it('refuses a change when the actor is not found as a member at the hook', async () => {
    const { owner, admin, member } = await team('juniper')
    const org = owner.organizationId
    vi.spyOn(t.data, 'membershipIn').mockResolvedValue(null)
    const refusal = {
      status: 403,
      body: { message: "You can't change this organization's members." },
    }
    expect(await setRole(owner, org, member.memberId, 'admin')).toMatchObject(refusal)
    expect(await remove(owner, org, admin.memberId)).toMatchObject(refusal)
    expect(
      await orgApi(t, owner.headers).post('invite-member', {
        organizationId: org,
        email: 'new@juniper.vc',
        role: 'member',
      }),
    ).toMatchObject(refusal)
    vi.restoreAllMocks()
    expect(await roles(org)).toMatchObject({
      'member@juniper.vc': 'member',
      'admin@juniper.vc': 'admin',
    })
  })

  it("does not reach another organization's member", async () => {
    const { owner } = await team('fir')
    const elsewhere = await team('fir-other')
    expect((await remove(owner, owner.organizationId, elsewhere.member.memberId)).status).toBe(400)
    expect(
      (await setRole(owner, owner.organizationId, elsewhere.member.memberId, 'admin')).status,
    ).toBe(403)
    expect(Object.keys(await roles(elsewhere.owner.organizationId))).toHaveLength(4)
  })

  it("revokes only the removed member's grants, and a leaver's own", async () => {
    const { owner, admin, member } = await team('hazel')
    const revoke = vi.spyOn(t.data, 'revokeGrants')
    await remove(owner, owner.organizationId, member.memberId)
    expect(revoke).toHaveBeenCalledWith(owner.organizationId, member.userId)

    revoke.mockClear()
    const left = await orgApi(t, admin.headers).post('leave', {
      organizationId: owner.organizationId,
    })
    expect(left.status).toBe(200)
    expect(revoke).toHaveBeenCalledWith(owner.organizationId, admin.userId)
    await expect(t.client(admin.headers).me.get()).resolves.toMatchObject({ organization: null })
  })
})
