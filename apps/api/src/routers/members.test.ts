import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { joined, ownerOf, sqlOf } from '../organizations/testing'
import { TEST_WEB_ORIGIN, type TestApp, createTestApp } from '../testing/app'

describe('members and invitations', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())
  afterEach(() => vi.restoreAllMocks())

  it('lists members oldest first and invites with a normalized email', async () => {
    const owner = await ownerOf(t, 'lucia@alder.vc', 'team', 'Lucía Gómez')
    const api = t.client(owner.headers)
    const invite = await api.invitations.invite({ email: '  Jon@Alder.VC ', role: 'member' })
    expect(invite).toMatchObject({ email: 'jon@alder.vc', role: 'member', emailSent: true })
    expect(invite.invitedOn).toBe(new Date().toISOString().slice(0, 10))
    expect(await api.invitations.list()).toEqual([invite])
    const mail = t.sent.at(-1)
    expect([mail?.to, mail?.subject]).toEqual([
      'jon@alder.vc',
      'Lucía invited you to Alder on Arrakit',
    ])
    expect(mail?.text).toContain(encodeURIComponent(`${TEST_WEB_ORIGIN}/join/${invite.id}`))

    await joined(t, owner, 'ana@alder.vc', 'admin', 'Ana')
    expect(await api.members.list()).toEqual([
      { name: 'Lucía Gómez', email: 'lucia@alder.vc', role: 'owner' },
      { name: 'Ana', email: 'ana@alder.vc', role: 'admin' },
    ])
  })

  it('refuses an invite on Free with the seat message, storing and sending nothing', async () => {
    const owner = await ownerOf(t, 'owner@quince.vc', 'free')
    const sent = t.sent.length
    await expect(
      t.client(owner.headers).invitations.invite({ email: 'ana@quince.vc', role: 'member' }),
    ).rejects.toMatchObject({
      status: 403,
      message:
        "Your organization's Free plan includes 1 seat, all taken. Upgrade to invite more people.",
    })
    expect(t.sent.length).toBe(sent)
    expect(await t.client(owner.headers).invitations.list()).toEqual([])
  })

  it('answers 400 for an unusable address or someone already in, sending nothing', async () => {
    const owner = await ownerOf(t, 'owner@birch.vc')
    const api = t.client(owner.headers)
    const sent = t.sent.length
    await expect(
      api.invitations.invite({ email: 'jon@organization', role: 'member' }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      api.invitations.invite({ email: 'OWNER@birch.vc', role: 'member' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'owner@birch.vc is already in the organization.',
    })
    await expect(
      api.invitations.invite({ email: 'x@birch.vc', role: 'owner' as 'admin' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(t.sent.length).toBe(sent)
  })

  it('refuses invites from a foreign or missing Origin', async () => {
    const owner = await ownerOf(t, 'owner@cedar.vc')
    for (const origin of [null, 'null', 'https://evil.example']) {
      const headers = new Headers(owner.headers)
      if (origin === null) headers.delete('origin')
      else headers.set('origin', origin)
      await expect(
        t.client(headers).invitations.invite({ email: 'x@cedar.vc', role: 'member' }),
      ).rejects.toMatchObject({ status: 403, message: 'Invite from the app.' })
    }
    expect(await t.client(owner.headers).invitations.list()).toEqual([])
  })

  it('answers 403 to a member on every call, 404 without an organization, 401 signed out', async () => {
    const owner = await ownerOf(t, 'owner@elm.vc')
    const member = await joined(t, owner, 'marta@elm.vc')
    const api = t.client(member.headers)
    const calls = [
      () => api.members.list(),
      () => api.members.changeRole({ email: 'owner@elm.vc', role: 'member' }),
      () => api.members.remove({ email: 'owner@elm.vc' }),
      () => api.invitations.list(),
      () => api.invitations.invite({ email: 'x@elm.vc', role: 'member' }),
      () => api.invitations.resend({ id: 'x' }),
      () => api.invitations.cancel({ id: 'x' }),
    ]
    for (const call of calls) await expect(call()).rejects.toMatchObject({ status: 403 })

    const loner = await t.signIn({ email: 'loner@elm.vc' })
    await expect(t.client(loner.headers).members.list()).rejects.toMatchObject({ status: 404 })
    await expect(t.client().members.list()).rejects.toMatchObject({ status: 401 })
  })

  it('lets the owner promote, demote and remove; an admin removes members only', async () => {
    const owner = await ownerOf(t, 'owner@fir.vc')
    const admin = await joined(t, owner, 'javi@fir.vc', 'admin', 'Javi')
    await joined(t, owner, 'marta@fir.vc', 'member', 'Marta')
    await joined(t, owner, 'leo@fir.vc')

    const asAdmin = t.client(admin.headers)
    await expect(
      asAdmin.members.changeRole({ email: 'marta@fir.vc', role: 'admin' }),
    ).rejects.toMatchObject({ status: 403, message: 'Only the owner names admins.' })
    await asAdmin.members.remove({ email: 'leo@fir.vc' })

    const asOwner = t.client(owner.headers)
    await expect(
      asOwner.members.changeRole({ email: 'MARTA@fir.vc', role: 'admin' }),
    ).resolves.toEqual({ name: 'Marta', email: 'marta@fir.vc', role: 'admin' })
    await expect(
      asOwner.members.changeRole({ email: 'owner@fir.vc', role: 'admin' }),
    ).rejects.toMatchObject({ status: 403, message: "You are the organization's only owner." })
    await expect(
      asOwner.members.changeRole({ email: 'nobody@fir.vc', role: 'member' }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'No one in the organization is nobody@fir.vc.',
    })
    await asOwner.members.remove({ email: 'javi@fir.vc' })
    expect((await asOwner.members.list()).map((m) => m.email)).toEqual([
      'owner@fir.vc',
      'marta@fir.vc',
    ])
    await expect(t.client(admin.headers).members.list()).rejects.toMatchObject({ status: 404 })
    await expect(t.client(admin.headers).me.get()).resolves.toMatchObject({ organization: null })
  })

  it('resends with a fresh expiry, cancels, and answers 404 for another organization', async () => {
    const owner = await ownerOf(t, 'owner@hazel.vc')
    const other = await ownerOf(t, 'owner@ivy.vc')
    const api = t.client(owner.headers)
    const invite = await api.invitations.invite({ email: 'lia@hazel.vc', role: 'member' })
    await expect(
      t.client(other.headers).invitations.resend({ id: invite.id }),
    ).rejects.toMatchObject({ status: 404, message: 'No such invitation in your organization.' })
    await expect(
      t.client(other.headers).invitations.cancel({ id: invite.id }),
    ).rejects.toMatchObject({ status: 404 })
    const sent = t.sent.length
    await expect(api.invitations.resend({ id: invite.id })).resolves.toMatchObject({
      id: invite.id,
      emailSent: true,
    })
    expect(t.sent.length).toBe(sent + 1)
    await api.invitations.cancel({ id: invite.id })
    expect(await api.invitations.list()).toEqual([])
    await expect(api.invitations.cancel({ id: invite.id })).rejects.toMatchObject({ status: 404 })
    await expect(api.invitations.resend({ id: invite.id })).rejects.toMatchObject({ status: 404 })
  })

  it('keeps an invite whose email failed: 201 unsent; a failed resend answers 503', async () => {
    const owner = await ownerOf(t, 'owner@juniper.vc')
    const api = t.client(owner.headers)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const send = vi.spyOn(t.deps.mailer, 'send').mockRejectedValueOnce(new Error('resend down'))
    const invite = await api.invitations.invite({ email: 'kim@juniper.vc', role: 'member' })
    expect(invite.emailSent).toBe(false)
    expect(String(errors.mock.calls[0]?.[0])).toContain(
      `organization ${owner.organization.id} invitation ${invite.id}`,
    )
    expect((await api.invitations.list())[0]?.emailSent).toBe(false)

    send.mockRejectedValueOnce(new Error('resend down'))
    await expect(api.invitations.resend({ id: invite.id })).rejects.toMatchObject({
      status: 503,
      message:
        'The invite to kim@juniper.vc is saved, but its email did not go out. Press Resend to send it again.',
    })
    expect((await api.invitations.list())[0]?.emailSent).toBe(false)
    await expect(api.invitations.resend({ id: invite.id })).resolves.toMatchObject({
      emailSent: true,
    })
  })

  it('answers emailSent true when the invite was canceled while its email went out', async () => {
    const owner = await ownerOf(t, 'owner@kale.vc')
    const api = t.client(owner.headers)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const real = t.deps.mailer.send.bind(t.deps.mailer)
    vi.spyOn(t.deps.mailer, 'send').mockImplementationOnce(async (mail) => {
      const [invite] = await api.invitations.list()
      if (invite) await api.invitations.cancel({ id: invite.id })
      await real(mail)
    })
    await expect(
      api.invitations.invite({ email: 'zed@kale.vc', role: 'member' }),
    ).resolves.toMatchObject({ emailSent: true })
    expect(await api.invitations.list()).toEqual([])
  })

  it('refuses to renew an expired invite whose seat was taken since', async () => {
    const owner = await ownerOf(t, 'owner@larch.vc', 'pro')
    const api = t.client(owner.headers)
    const old = await api.invitations.invite({ email: 'ana@larch.vc', role: 'member' })
    await sqlOf(t)(`update invitations set expires_at = now() - interval '1 day' where id = $1`, [
      old.id,
    ])
    await api.invitations.invite({ email: 'bo@larch.vc', role: 'member' })
    await api.invitations.invite({ email: 'cy@larch.vc', role: 'member' })
    await expect(api.invitations.resend({ id: old.id })).rejects.toMatchObject({ status: 403 })
  })
  it('lets an admin invite an admin and step down, but not demote or remove another admin', async () => {
    const owner = await ownerOf(t, 'owner@maple.vc')
    const admin = await joined(t, owner, 'ana@maple.vc', 'admin', 'Ana')
    await joined(t, owner, 'bo@maple.vc', 'admin', 'Bo')
    const asAdmin = t.client(admin.headers)

    await expect(
      asAdmin.invitations.invite({ email: 'cy@maple.vc', role: 'admin' }),
    ).resolves.toMatchObject({ email: 'cy@maple.vc', role: 'admin' })
    await expect(
      asAdmin.members.changeRole({ email: 'bo@maple.vc', role: 'member' }),
    ).rejects.toMatchObject({ status: 403, message: 'Only the owner demotes or removes an admin.' })
    await expect(asAdmin.members.remove({ email: 'bo@maple.vc' })).rejects.toMatchObject({
      status: 403,
      message: 'Only the owner demotes or removes an admin.',
    })
    await expect(asAdmin.members.remove({ email: 'owner@maple.vc' })).rejects.toMatchObject({
      status: 403,
      message: "Only the owner changes the owner's role or seat.",
    })
    await expect(
      asAdmin.members.changeRole({ email: 'ana@maple.vc', role: 'owner' as 'admin' }),
    ).rejects.toMatchObject({ status: 400 })

    await expect(
      asAdmin.members.changeRole({ email: 'ana@maple.vc', role: 'member' }),
    ).resolves.toEqual({ name: 'Ana', email: 'ana@maple.vc', role: 'member' })
    await expect(asAdmin.members.list()).rejects.toMatchObject({ status: 403 })
  })

  it("answers 404 for another organization's member and keeps them", async () => {
    const owner = await ownerOf(t, 'owner@nettle.vc')
    const other = await ownerOf(t, 'owner@oleander.vc')
    await joined(t, other, 'kim@oleander.vc')
    const api = t.client(owner.headers)
    await expect(api.members.remove({ email: 'kim@oleander.vc' })).rejects.toMatchObject({
      status: 404,
      message: 'No one in the organization is kim@oleander.vc.',
    })
    await expect(
      api.members.changeRole({ email: 'kim@oleander.vc', role: 'admin' }),
    ).rejects.toMatchObject({ status: 404 })
    expect((await t.client(other.headers).members.list()).map((m) => m.email)).toEqual([
      'owner@oleander.vc',
      'kim@oleander.vc',
    ])
  })

  it('keeps emailSent true when a resend of a delivered invite fails', async () => {
    const owner = await ownerOf(t, 'owner@poplar.vc')
    const api = t.client(owner.headers)
    const invite = await api.invitations.invite({ email: 'lu@poplar.vc', role: 'member' })
    expect(invite.emailSent).toBe(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(t.deps.mailer, 'send').mockRejectedValueOnce(new Error('resend down'))
    await expect(api.invitations.resend({ id: invite.id })).rejects.toMatchObject({ status: 503 })
    expect((await api.invitations.list())[0]).toMatchObject({ id: invite.id, emailSent: true })
  })

  it('answers the resend when its email went out but marking it sent failed', async () => {
    const owner = await ownerOf(t, 'owner@rowan.vc')
    const api = t.client(owner.headers)
    const invite = await api.invitations.invite({ email: 'sol@rowan.vc', role: 'member' })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const real = t.data.forOrganization.bind(t.data)
    vi.spyOn(t.data, 'forOrganization').mockImplementation((id) => {
      const scope = real(id)
      vi.spyOn(scope.members, 'markEmailSent').mockRejectedValue(new Error('db down'))
      return scope
    })
    const sent = t.sent.length
    await expect(api.invitations.resend({ id: invite.id })).resolves.toMatchObject({
      id: invite.id,
      email: 'sol@rowan.vc',
      emailSent: true,
    })
    expect(t.sent.length).toBe(sent + 1)
    expect(errors.mock.calls.map((call) => String(call[0]))).toContain(
      `organization ${owner.organization.id} invitation ${invite.id}: sent, but not marked sent`,
    )
  })

  it('answers the invite when its email went out but marking it sent failed', async () => {
    const owner = await ownerOf(t, 'owner@sorrel.vc')
    const api = t.client(owner.headers)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const real = t.data.forOrganization.bind(t.data)
    vi.spyOn(t.data, 'forOrganization').mockImplementation((id) => {
      const scope = real(id)
      vi.spyOn(scope.members, 'markEmailSent').mockRejectedValue(new Error('db down'))
      return scope
    })
    await expect(
      api.invitations.invite({ email: 'tam@sorrel.vc', role: 'member' }),
    ).resolves.toMatchObject({ email: 'tam@sorrel.vc', emailSent: true })
  })

  it('re-invites the same address in place: same id, new role, no extra seat', async () => {
    const owner = await ownerOf(t, 'owner@quill.vc', 'pro')
    const api = t.client(owner.headers)
    const first = await api.invitations.invite({ email: 'mo@quill.vc', role: 'member' })
    await api.invitations.invite({ email: 'ny@quill.vc', role: 'member' })
    const again = await api.invitations.invite({ email: 'MO@quill.vc', role: 'admin' })
    expect(again).toMatchObject({ id: first.id, role: 'admin', emailSent: true })
    expect((await api.invitations.list()).map((i) => i.email)).toEqual([
      'mo@quill.vc',
      'ny@quill.vc',
    ])
  })
})
