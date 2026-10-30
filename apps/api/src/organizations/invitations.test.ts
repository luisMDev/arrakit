import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { TEST_WEB_ORIGIN, type TestApp, createTestApp } from '../testing/app'
import { type Person, joinAs, joined, orgApi, ownerOf, sqlOf } from '../testing/people'

const SEAT_MESSAGE =
  "Your organization's Free plan includes 1 seat, all taken. Upgrade to invite more people."

interface InvitationRow {
  id: string
  email: string
  role: string
  status: string
  emailSent: boolean
}

describe('invitations (Better Auth organization plugin)', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())
  afterEach(() => vi.restoreAllMocks())

  type Inviter = Person & { organizationId: string }

  const invite = (inviter: Inviter, email: string, role = 'member', extra = {}) =>
    orgApi(t, inviter.headers).post<InvitationRow>('invite-member', {
      email,
      role,
      organizationId: inviter.organizationId,
      ...extra,
    })

  const live = async (inviter: Inviter) =>
    (
      await orgApi(t, inviter.headers).get<InvitationRow[]>('list-invitations', {
        organizationId: inviter.organizationId,
      })
    ).body.filter((row) => row.status === 'pending')

  const accept = (person: { headers: Headers }, invitationId: string) =>
    orgApi(t, person.headers).post('accept-invitation', { invitationId })

  const expire = (invitationId: string) =>
    sqlOf(t)(`update invitations set expires_at = now() - interval '1 day' where id = $1`, [
      invitationId,
    ])

  describe('invite', () => {
    it('stores a normalized address, mails a magic link to the join page, and marks it sent', async () => {
      const owner = await ownerOf(t, 'lucia@alder.vc', 'team', 'Lucía Gómez')
      const invited = await invite(owner, '  Jon@Alder.VC ')
      expect(invited).toMatchObject({
        status: 200,
        body: { email: 'jon@alder.vc', role: 'member' },
      })
      const mail = t.sent.at(-1)
      expect([mail?.to, mail?.subject]).toEqual([
        'jon@alder.vc',
        'Lucía invited you to Alder on Arrakit',
      ])
      expect(mail?.text).toContain('7 days')
      expect(mail?.text).toContain(encodeURIComponent(`${TEST_WEB_ORIGIN}/join/${invited.body.id}`))
      expect(await live(owner)).toEqual([
        expect.objectContaining({ id: invited.body.id, emailSent: true }),
      ])
    })

    it('names an inviter with no name by the local part of their email', async () => {
      const owner = await ownerOf(t, 'jane@oak.vc', 'team', ' ')
      await invite(owner, 'jon@oak.vc')
      expect(t.sent.at(-1)?.subject).toBe('jane invited you to Oak on Arrakit')
    })

    it('refuses an address that is no work email, and someone already in, sending nothing', async () => {
      const owner = await ownerOf(t, 'owner@birch.vc')
      const sent = t.sent.length
      expect(await invite(owner, 'jon@organization')).toMatchObject({
        status: 400,
        body: {
          message: 'Enter a work email, like name@organization.com: "jon@organization" is not one.',
        },
      })
      expect((await invite(owner, 'Owner@Birch.vc')).status).toBe(400)
      expect(t.sent.length).toBe(sent)
      expect(await live(owner)).toEqual([])
    })

    it('refuses an invite on Free with the seat message, storing and sending nothing', async () => {
      const owner = await ownerOf(t, 'owner@quince.vc', 'free')
      const sent = t.sent.length
      expect(await invite(owner, 'ana@quince.vc')).toMatchObject({
        status: 403,
        body: { message: SEAT_MESSAGE },
      })
      expect(t.sent.length).toBe(sent)
      expect(await live(owner)).toEqual([])
    })

    it('re-invites a pending address in place of the old one, taking no extra seat', async () => {
      const owner = await ownerOf(t, 'owner@rowan.vc', 'pro')
      const first = await invite(owner, 'ana@rowan.vc')
      await invite(owner, 'bo@rowan.vc')
      const again = await invite(owner, 'ana@rowan.vc', 'admin')
      expect(again.status).toBe(200)
      expect(again.body.id).not.toBe(first.body.id)
      expect((await live(owner)).map((row) => [row.email, row.role])).toEqual([
        ['bo@rowan.vc', 'member'],
        ['ana@rowan.vc', 'admin'],
      ])
    })

    it('frees the seat of a cancelled or expired invite; renewing an expired one needs a seat', async () => {
      const owner = await ownerOf(t, 'owner@larch.vc', 'pro')
      const old = await invite(owner, 'ana@larch.vc')
      const cancelled = await invite(owner, 'bo@larch.vc')
      expect((await invite(owner, 'cy@larch.vc')).status).toBe(403)

      const api = orgApi(t, owner.headers)
      expect(
        (await api.post('cancel-invitation', { invitationId: cancelled.body.id })).status,
      ).toBe(200)
      expect((await invite(owner, 'cy@larch.vc')).status).toBe(200)
      expect((await invite(owner, 'di@larch.vc')).status).toBe(403)

      await expire(old.body.id)
      expect((await invite(owner, 'di@larch.vc')).status).toBe(200)
      expect(await invite(owner, 'ana@larch.vc', 'member', { resend: true })).toMatchObject({
        status: 403,
        body: { message: expect.stringContaining('Pro plan includes 3 seats') },
      })
    })

    it('resends a live invite with a fresh expiry and a new email', async () => {
      const owner = await ownerOf(t, 'owner@maple.vc')
      const first = await invite(owner, 'ana@maple.vc')
      await sqlOf(t)(`update invitations set expires_at = now() + interval '1 day' where id = $1`, [
        first.body.id,
      ])
      const sent = t.sent.length
      const resent = await invite(owner, 'ana@maple.vc', 'member', { resend: true })
      expect(resent.body.id).toBe(first.body.id)
      expect(t.sent.length).toBe(sent + 1)
      const [row] = await live(owner)
      expect(
        new Date((row as unknown as { expiresAt: string }).expiresAt).getTime(),
      ).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000)
    })

    it('keeps an invite whose email failed, answering 503; a later resend marks it sent', async () => {
      const owner = await ownerOf(t, 'owner@juniper.vc')
      const errors = t.errorLog()
      const send = vi.spyOn(t.deps.mailer, 'send').mockRejectedValueOnce(new Error('resend down'))
      const MESSAGE =
        'The invite to kim@juniper.vc is saved, but its email did not go out. Press Resend to send it again.'
      expect(await invite(owner, 'kim@juniper.vc')).toMatchObject({
        status: 503,
        body: { message: MESSAGE },
      })
      const [row] = await live(owner)
      expect(row).toMatchObject({ email: 'kim@juniper.vc', emailSent: false })
      expect(errors()[0]).toMatchObject({
        msg: 'invite email not sent',
        organizationId: owner.organizationId,
        invitationId: row!.id,
      })

      send.mockRejectedValueOnce(new Error('resend down'))
      expect(await invite(owner, 'kim@juniper.vc', 'member', { resend: true })).toMatchObject({
        status: 503,
        body: { message: MESSAGE },
      })
      expect((await live(owner))[0]?.emailSent).toBe(false)
      expect((await invite(owner, 'kim@juniper.vc', 'member', { resend: true })).status).toBe(200)
      expect((await live(owner))[0]?.emailSent).toBe(true)
    })

    it('refuses an owner invite, and an admin inviting an admin', async () => {
      const owner = await ownerOf(t, 'owner@pine.vc')
      expect(await invite(owner, 'ana@pine.vc', 'owner')).toMatchObject({
        status: 403,
        body: { message: 'No one is made owner: the organization has its creator.' },
      })
      const admin = await joined(t, owner, 'adm@pine.vc', 'admin')
      expect(
        await invite({ ...admin, organizationId: owner.organizationId }, 'bo@pine.vc', 'admin'),
      ).toMatchObject({
        status: 403,
        body: { message: 'Only the owner names admins.' },
      })
      expect(
        (await invite({ ...admin, organizationId: owner.organizationId }, 'bo@pine.vc')).status,
      ).toBe(200)
    })

    it('answers 403 to a member and 401 signed out', async () => {
      const owner = await ownerOf(t, 'owner@poplar.vc')
      const member = await joined(t, owner, 'marta@poplar.vc')
      expect(
        (await invite({ ...member, organizationId: owner.organizationId }, 'x@poplar.vc')).status,
      ).toBe(403)
      expect((await invite({ ...owner, headers: new Headers() }, 'x@poplar.vc')).status).toBe(401)
    })
  })

  describe('accept', () => {
    it('joins through the mailed link, switching the session to the new organization', async () => {
      const owner = await ownerOf(t, 'lucia@halden.vc', 'team', 'Lucía')
      const elsewhere = await ownerOf(t, 'jon@halden.vc')
      const invited = await invite(owner, 'jon@halden.vc')
      const link = new URL(t.linkFor('jon@halden.vc'))
      const opened = await t.request(link.pathname + link.search, { redirect: 'manual' })
      expect(opened.headers.get('location')).toBe(`${TEST_WEB_ORIGIN}/join/${invited.body.id}`)

      expect((await accept(elsewhere, invited.body.id)).status).toBe(200)
      await expect(t.client(elsewhere.headers).me.get()).resolves.toMatchObject({
        organization: { id: owner.organizationId },
        role: 'member',
      })
    })

    it('answers 409 to someone already in that organization', async () => {
      const owner = await ownerOf(t, 'owner@hazel.vc')
      const member = await joinAs(t, owner.organizationId, 'ana@hazel.vc', 'member')
      await sqlOf(t)(
        `insert into invitations (id, organization_id, email, role, status, expires_at, inviter_id)
         values (gen_random_uuid(), $1, 'ana@hazel.vc', 'member', 'pending', now() + interval '1 day', $2)`,
        [owner.organizationId, owner.userId],
      )
      const { rows } = await sqlOf(t)('select id from invitations where email = $1', [
        'ana@hazel.vc',
      ])
      expect(await accept(member, String(rows[0]!.id))).toMatchObject({
        status: 409,
        body: { message: "You're already in Hazel." },
      })
    })

    it('refuses another address, a closed invitation, and anyone signed out', async () => {
      const owner = await ownerOf(t, 'owner@cedar.vc')
      const kim = await invite(owner, 'kim@cedar.vc')
      const stranger = await t.signIn({ email: 'stranger@cedar.vc' })
      expect((await accept(stranger, kim.body.id)).status).toBe(403)
      expect((await accept({ headers: new Headers() }, kim.body.id)).status).toBe(401)

      const kimPerson = await t.signIn({ email: 'kim@cedar.vc' })
      for (const id of ['nope', crypto.randomUUID()]) {
        expect((await accept(kimPerson, id)).status).toBe(400)
      }
      await expire(kim.body.id)
      expect((await accept(kimPerson, kim.body.id)).status).toBe(400)

      const lee = await invite(owner, 'lee@cedar.vc')
      await orgApi(t, owner.headers).post('cancel-invitation', { invitationId: lee.body.id })
      const leePerson = await t.signIn({ email: 'lee@cedar.vc' })
      expect((await accept(leePerson, lee.body.id)).status).toBe(400)
    })

    it('counts only members against seats when accepting', async () => {
      const owner = await ownerOf(t, 'owner@elm.vc', 'pro')
      const first = await invite(owner, 'ana@elm.vc')
      const second = await invite(owner, 'bo@elm.vc')
      await t.data.forOrganization(owner.organizationId).setPlan('free')
      const ana = await t.signIn({ email: 'ana@elm.vc' })
      expect((await accept(ana, first.body.id)).status).toBe(403)
      await t.data.forOrganization(owner.organizationId).setPlan('pro')
      expect((await accept(ana, first.body.id)).status).toBe(200)
      const bo = await t.signIn({ email: 'bo@elm.vc' })
      expect((await accept(bo, second.body.id)).status).toBe(200)
    })

    it('lets an Internal organization grow past ten people', async () => {
      const owner = await ownerOf(t, 'owner@internal.vc', 'internal')
      for (let i = 0; i < 11; i++) await joined(t, owner, `p${i}@internal.vc`)
      expect(await t.data.forOrganization(owner.organizationId).members.list()).toHaveLength(12)
    })
  })
})
