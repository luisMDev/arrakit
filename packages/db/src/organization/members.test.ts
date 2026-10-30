import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { invitations, members } from '../schema/index'
import {
  type TestData,
  insertMember,
  insertOrganization,
  insertUser,
  openTestData,
} from '../testing'

describe('organization members', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  const organizationOf = async (tag: string) => {
    const owner = await insertUser(data, `owner@${tag}.vc`, `Owner ${tag}`)
    const organization = await insertOrganization(data, { slug: tag })
    await insertMember(data, organization.id, owner, 'owner')
    return { id: organization.id, owner, members: data.forOrganization(organization.id).members }
  }

  const invite = async (organizationId: string, inviterId: string, email: string, days = 7) => {
    const [row] = await data.db
      .insert(invitations)
      .values({
        organizationId,
        email,
        inviterId,
        role: 'member',
        expiresAt: sql`now() + make_interval(days => ${days})`,
      })
      .returning()
    return row!
  }

  it('lists members oldest first with their role string', async () => {
    const f = await organizationOf('alder')
    const ana = await insertUser(data, 'ana@alder.vc', 'Ana')
    await insertMember(data, f.id, ana, 'admin,finance')
    expect((await f.members.list()).map(({ email, role }) => ({ email, role }))).toEqual([
      { email: 'owner@alder.vc', role: 'owner' },
      { email: 'ana@alder.vc', role: 'admin,finance' },
    ])
  })

  it('counts members and live invitations as seats, not the address re-invited', async () => {
    const f = await organizationOf('birch')
    await invite(f.id, f.owner, 'ana@birch.vc')
    await invite(f.id, f.owner, 'old@birch.vc', -1)
    const cancelled = await invite(f.id, f.owner, 'gone@birch.vc')
    await data.db
      .update(invitations)
      .set({ status: 'canceled' })
      .where(eq(invitations.id, cancelled.id))
    const other = await organizationOf('cedar')
    await invite(other.id, other.owner, 'ana@cedar.vc')

    expect(await f.members.seatsTaken('new@birch.vc')).toBe(2)
    expect(await f.members.seatsTaken(' Ana@Birch.vc ')).toBe(1)
  })

  it('records whether the invite email went out, only for its own invitation', async () => {
    const f = await organizationOf('elm')
    const other = await organizationOf('fir')
    const invitation = await invite(f.id, f.owner, 'ana@elm.vc')
    const emailSent = async () =>
      (await data.db.select().from(invitations).where(eq(invitations.id, invitation.id)))[0]
        ?.emailSent

    await other.members.markInvitationEmailSent(invitation.id, true)
    expect(await emailSent()).toBe(false)
    await f.members.markInvitationEmailSent(invitation.id, true)
    expect(await emailSent()).toBe(true)
    await f.members.markInvitationEmailSent(invitation.id, false)
    expect(await emailSent()).toBe(false)
  })

  it('records when a member accepted the terms', async () => {
    const f = await organizationOf('hazel')
    await f.members.acceptTerms(f.owner)
    const [row] = await data.db.select().from(members).where(eq(members.userId, f.owner))
    expect(row?.termsAcceptedAt).toBeInstanceOf(Date)
  })
})
