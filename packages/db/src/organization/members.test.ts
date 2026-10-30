import { randomUUID } from 'node:crypto'

import type { Plan } from '@arrakit/plans'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AlreadyMemberError,
  InvitationNotFoundError,
  InviteEmailUnusableError,
  MemberChangeRefusedError,
  NoSuchMemberError,
  PersonHasOrganizationError,
  SeatLimitError,
} from '../errors'
import {
  invitations,
  members,
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  organizations,
  users,
} from '../schema/index'
import { type TestData, openTestData } from '../testing'

describe('organization members', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  const person = async (email: string, name = ''): Promise<string> => {
    const id = randomUUID()
    await data.db.insert(users).values({ id, name, email })
    return id
  }

  const organizationOf = async (tag: string, plan: Plan = 'team') => {
    const ownerEmail = `owner@${tag}.vc`
    const owner = await person(ownerEmail, `Owner ${tag}`)
    const [organization] = await data.db
      .insert(organizations)
      .values({ name: `Organization ${tag}`, slug: tag, plan })
      .returning()
    await data.db
      .insert(members)
      .values({ organizationId: organization!.id, userId: owner, role: 'owner' })
    return {
      organization: organization!,
      owner,
      ownerEmail,
      members: data.forOrganization(organization!.id).members,
    }
  }
  type Fixture = Awaited<ReturnType<typeof organizationOf>>

  const join = async (f: Fixture, email: string, role: 'admin' | 'member' = 'member') => {
    const userId = await person(email, email.split('@')[0])
    const invitation = await f.members.invite({ email, role, inviterId: f.owner })
    await data.acceptInvitation({ invitationId: invitation.id, userId, email })
    return userId
  }

  const expire = (id: string) =>
    data.db
      .update(invitations)
      .set({ expiresAt: sql`now() - interval '1 day'` })
      .where(eq(invitations.id, id))

  const grantFor = async (userId: string, organizationId: string) => {
    const clientId = `client-${randomUUID()}`
    await data.db.insert(oauthClients).values({ id: clientId, clientId, redirectUris: [] })
    await data.db.insert(oauthAccessTokens).values({
      id: randomUUID(),
      clientId,
      userId,
      referenceId: organizationId,
      scopes: [],
    })
    await data.db
      .insert(oauthConsents)
      .values({ id: randomUUID(), clientId, userId, referenceId: organizationId, scopes: [] })
  }
  const grantsOf = async (userId: string) =>
    (await data.db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.userId, userId)))
      .length +
    (await data.db.select().from(oauthConsents).where(eq(oauthConsents.userId, userId))).length

  it('invites someone, lists the invite, and puts them in the organization when they accept', async () => {
    const f = await organizationOf('alder')
    const invitation = await f.members.invite({
      email: ' Jon@Alder.VC ',
      role: 'member',
      inviterId: f.owner,
    })
    expect(invitation).toMatchObject({ email: 'jon@alder.vc', role: 'member', emailSent: false })
    const days = (invitation.expiresAt.getTime() - Date.now()) / 86_400_000
    expect(days).toBeCloseTo(7, 1)
    expect(invitation.expiresAt.getTime() - invitation.sentAt.getTime()).toBe(7 * 86_400_000)
    expect(await f.members.invitations()).toEqual([invitation])

    const jon = await person('jon@alder.vc', 'Jon')
    const membership = await data.acceptInvitation({
      invitationId: invitation.id,
      userId: jon,
      email: 'jon@alder.vc',
    })
    expect(membership).toEqual({ organization: f.organization, role: 'member' })
    expect(await data.memberOf(jon)).toEqual({ organization: f.organization, role: 'member' })
    expect(await f.members.invitations()).toEqual([])
    expect(
      (await f.members.list()).map(({ email, role, name }) => ({ email, role, name })),
    ).toEqual([
      { email: 'owner@alder.vc', role: 'owner', name: 'Owner alder' },
      { email: 'jon@alder.vc', role: 'member', name: 'Jon' },
    ])
  })

  it('removes a member and revokes only their grants for the organization', async () => {
    const f = await organizationOf('birch')
    const ana = await join(f, 'ana@birch.vc')
    await grantFor(ana, f.organization.id)
    await grantFor(f.owner, f.organization.id)
    await f.members.remove(f.owner, 'ANA@birch.vc')
    expect(await data.memberOf(ana)).toBeNull()
    expect((await f.members.list()).map((m) => m.email)).toEqual(['owner@birch.vc'])
    expect(await grantsOf(ana)).toBe(0)
    expect(await grantsOf(f.owner)).toBe(2)
  })

  it('keeps the grants of a member whose removal the policy refuses', async () => {
    const f = await organizationOf('cedar')
    const javi = await join(f, 'javi@cedar.vc', 'admin')
    await grantFor(f.owner, f.organization.id)
    await expect(f.members.remove(javi, f.ownerEmail)).rejects.toBeInstanceOf(
      MemberChangeRefusedError,
    )
    expect(await grantsOf(f.owner)).toBe(2)
  })

  it("never shows one organization's members or invites to another", async () => {
    const a = await organizationOf('elm')
    const b = await organizationOf('fir')
    const invite = await a.members.invite({
      email: 'x@elm.vc',
      role: 'member',
      inviterId: a.owner,
    })
    expect((await b.members.list()).map((m) => m.email)).toEqual(['owner@fir.vc'])
    expect(await b.members.invitations()).toEqual([])
    expect(await b.members.cancel(invite.id)).toBe(false)
    expect(await b.members.resend(invite.id)).toBeUndefined()
    expect(await b.members.markEmailSent(invite.id)).toBeUndefined()
    await expect(b.members.remove(b.owner, a.ownerEmail)).rejects.toBeInstanceOf(NoSuchMemberError)
  })

  it('marks an invite sent, and reads it unsent again once the same address is re-invited', async () => {
    const f = await organizationOf('hazel')
    const first = await f.members.invite({
      email: 'ana@hazel.vc',
      role: 'member',
      inviterId: f.owner,
    })
    expect((await f.members.markEmailSent(first.id))?.emailSent).toBe(true)
    const again = await f.members.invite({
      email: 'ana@hazel.vc',
      role: 'admin',
      inviterId: f.owner,
    })
    expect(again).toMatchObject({ id: first.id, role: 'admin', emailSent: false })
    expect(await f.members.invitations()).toHaveLength(1)
  })

  it('refuses to invite someone already in the organization, or an address we cannot write to', async () => {
    const f = await organizationOf('ivy')
    await expect(
      f.members.invite({ email: 'Owner@Ivy.vc', role: 'member', inviterId: f.owner }),
    ).rejects.toBeInstanceOf(AlreadyMemberError)
    await expect(
      f.members.invite({ email: 'jon@organization', role: 'member', inviterId: f.owner }),
    ).rejects.toBeInstanceOf(InviteEmailUnusableError)
  })

  it("refuses an invite past the plan's seats, pending invitations counted, and frees one on cancel", async () => {
    const f = await organizationOf('larch', 'pro')
    await join(f, 'ana@larch.vc')
    const pending = await f.members.invite({
      email: 'bo@larch.vc',
      role: 'member',
      inviterId: f.owner,
    })
    await expect(
      f.members.invite({ email: 'cy@larch.vc', role: 'member', inviterId: f.owner }),
    ).rejects.toThrow("Your organization's Pro plan includes 3 seats, all taken.")
    await expect(
      f.members.invite({ email: 'bo@larch.vc', role: 'admin', inviterId: f.owner }),
    ).resolves.toMatchObject({ email: 'bo@larch.vc', role: 'admin' })
    await f.members.cancel(pending.id)
    await expect(
      f.members.invite({ email: 'cy@larch.vc', role: 'member', inviterId: f.owner }),
    ).resolves.toMatchObject({ email: 'cy@larch.vc' })
  })

  it('refuses to renew an expired invitation whose seat was taken since', async () => {
    const f = await organizationOf('seatrenew', 'pro')
    const old = await f.members.invite({
      email: 'ana@seatrenew.vc',
      role: 'member',
      inviterId: f.owner,
    })
    await expire(old.id)
    await join(f, 'bo@seatrenew.vc')
    await f.members.invite({ email: 'cy@seatrenew.vc', role: 'member', inviterId: f.owner })
    await expect(f.members.resend(old.id)).rejects.toBeInstanceOf(SeatLimitError)
  })

  it('lets invitations sent before a move to a smaller plan in only while a seat is left', async () => {
    const f = await organizationOf('seatdown')
    const sent = []
    for (const name of ['ana', 'bo', 'cy']) {
      sent.push(
        await f.members.invite({
          email: `${name}@seatdown.vc`,
          role: 'member',
          inviterId: f.owner,
        }),
      )
    }
    await data.db
      .update(organizations)
      .set({ plan: 'pro' })
      .where(eq(organizations.id, f.organization.id))
    const accept = async (name: string, invitationId: string) =>
      data.acceptInvitation({
        invitationId,
        userId: await person(`${name}@seatdown.vc`),
        email: `${name}@seatdown.vc`,
      })
    await accept('ana', sent[0]!.id)
    await accept('bo', sent[1]!.id)
    await expect(accept('cy', sent[2]!.id)).rejects.toBeInstanceOf(SeatLimitError)
  })

  it("takes an internal organization past Team's ten seats", async () => {
    const f = await organizationOf('internal', 'internal')
    for (let i = 1; i <= 10; i++) await join(f, `p${i}@internal.vc`)
    expect(await f.members.list()).toHaveLength(11)
  })

  it('leaves a Free organization no seat to invite into', async () => {
    const f = await organizationOf('quince', 'free')
    await expect(
      f.members.invite({ email: 'ana@quince.vc', role: 'member', inviterId: f.owner }),
    ).rejects.toThrow(
      "Your organization's Free plan includes 1 seat, all taken. Upgrade to invite more people.",
    )
  })

  it('refuses an invite from a member, and lets an admin invite an admin', async () => {
    const f = await organizationOf('oak')
    const marta = await join(f, 'marta@oak.vc')
    const javi = await join(f, 'javi@oak.vc', 'admin')
    await expect(
      f.members.invite({ email: 'x@oak.vc', role: 'member', inviterId: marta }),
    ).rejects.toBeInstanceOf(MemberChangeRefusedError)
    expect(await f.members.invitations()).toEqual([])
    await f.members.invite({ email: 'x@oak.vc', role: 'admin', inviterId: javi })
    expect((await f.members.invitations()).map((i) => i.role)).toEqual(['admin'])
  })

  it('sends an invite again with a fresh expiry, and cancels it', async () => {
    const f = await organizationOf('yew')
    const invitation = await f.members.invite({
      email: 'lia@yew.vc',
      role: 'member',
      inviterId: f.owner,
    })
    await data.db
      .update(invitations)
      .set({ expiresAt: sql`now() + interval '1 day'` })
      .where(eq(invitations.id, invitation.id))
    const resent = await f.members.resend(invitation.id)
    expect(resent?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * 86_400_000)

    expect(await f.members.cancel(invitation.id)).toBe(true)
    expect(await f.members.cancel(invitation.id)).toBe(false)
    expect(await f.members.invitations()).toEqual([])
    const lia = await person('lia@yew.vc')
    await expect(
      data.acceptInvitation({ invitationId: invitation.id, userId: lia, email: 'lia@yew.vc' }),
    ).rejects.toBeInstanceOf(InvitationNotFoundError)
  })

  it('changes a role through the policy: the owner promotes, an admin may not', async () => {
    const f = await organizationOf('rowan')
    const javi = await join(f, 'javi@rowan.vc', 'admin')
    await join(f, 'marta@rowan.vc')
    await expect(f.members.changeRole(javi, 'marta@rowan.vc', 'admin')).rejects.toBeInstanceOf(
      MemberChangeRefusedError,
    )
    const promoted = await f.members.changeRole(f.owner, 'Marta@rowan.vc', 'admin')
    expect(promoted).toMatchObject({ email: 'marta@rowan.vc', role: 'admin' })
    await expect(f.members.changeRole(f.owner, f.ownerEmail, 'admin')).rejects.toThrow(/only owner/)
    await expect(f.members.changeRole(f.owner, 'nobody@rowan.vc', 'member')).rejects.toThrow(
      'No one in the organization is nobody@rowan.vc.',
    )
  })

  it('lets exactly one of two last admins step down when both try at once', async () => {
    const [organization] = await data.db
      .insert(organizations)
      .values({ name: 'Legacy Larch', slug: 'legacy-larch', plan: 'team' })
      .returning()
    const a = await person('a@legacy.vc')
    const b = await person('b@legacy.vc')
    for (const userId of [a, b]) {
      await data.db
        .insert(members)
        .values({ organizationId: organization!.id, userId, role: 'admin' })
    }
    const scoped = data.forOrganization(organization!.id).members
    const results = await Promise.allSettled([
      scoped.changeRole(a, 'a@legacy.vc', 'member'),
      scoped.changeRole(b, 'b@legacy.vc', 'member'),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refused = results.find((r) => r.status === 'rejected')
    expect(refused?.status === 'rejected' && refused.reason).toBeInstanceOf(
      MemberChangeRefusedError,
    )
    expect((await scoped.list()).map((m) => m.role).sort()).toEqual(['admin', 'member'])
  })

  describe('accepting an invitation', () => {
    let f: Fixture
    let invitationId: string

    beforeAll(async () => {
      f = await organizationOf('juniper')
      ;({ id: invitationId } = await f.members.invite({
        email: 'jon@organization.com',
        role: 'member',
        inviterId: f.owner,
      }))
    })

    it.each([
      'jon+x@organization.com',
      'jon@organization.com.',
      'jo@organization.com',
      'njon@organization.com',
    ])('refuses the invitation to %j', async (email) => {
      expect(await data.invitationFor(invitationId, email)).toBeNull()
      const userId = await person(email)
      await expect(data.acceptInvitation({ invitationId, userId, email })).rejects.toBeInstanceOf(
        InvitationNotFoundError,
      )
    })

    it.each(['', "' OR 1=1 --", randomUUID(), 42 as unknown as string])(
      'answers not found for the id %j',
      async (id) => {
        expect(await data.invitationFor(id, 'jon@organization.com')).toBeNull()
        await expect(
          data.acceptInvitation({ invitationId: id, userId: f.owner, email: f.ownerEmail }),
        ).rejects.toBeInstanceOf(InvitationNotFoundError)
      },
    )

    it('reads the invitation with its organization and inviter for its own address', async () => {
      expect(await data.invitationFor(invitationId, ' JON@organization.com ')).toMatchObject({
        id: invitationId,
        role: 'member',
        organization: { name: 'Organization juniper' },
        inviter: { name: 'Owner juniper', email: 'owner@juniper.vc' },
      })
    })

    it.each(['expired', 'canceled', 'accepted'])('refuses an invitation %s', async (state) => {
      const email = `${state}@organization.com`
      const { id } = await f.members.invite({ email, role: 'member', inviterId: f.owner })
      if (state === 'expired') await expire(id)
      else await data.db.update(invitations).set({ status: state }).where(eq(invitations.id, id))
      const userId = await person(email)
      await expect(
        data.acceptInvitation({ invitationId: id, userId, email }),
      ).rejects.toBeInstanceOf(InvitationNotFoundError)
    })

    it('refuses someone who already has an organization, and keeps the invite', async () => {
      const other = await organizationOf('kale')
      const email = 'owner@kale.vc'
      const { id } = await f.members.invite({ email, role: 'member', inviterId: f.owner })
      await expect(
        data.acceptInvitation({ invitationId: id, userId: other.owner, email }),
      ).rejects.toBeInstanceOf(PersonHasOrganizationError)
      expect((await f.members.invitations()).map((i) => i.id)).toContain(id)
    })

    it('accepts the address written in capitals and spaces, once, as the role invited', async () => {
      const email = 'zoe@organization.com'
      const { id } = await f.members.invite({ email, role: 'admin', inviterId: f.owner })
      const zoe = await person(email)
      await expect(
        data.acceptInvitation({ invitationId: id, userId: zoe, email: ' ZOE@Organization.com ' }),
      ).resolves.toMatchObject({ role: 'admin' })
      await expect(
        data.acceptInvitation({ invitationId: id, userId: zoe, email }),
      ).rejects.toBeInstanceOf(InvitationNotFoundError)
    })
  })
})
