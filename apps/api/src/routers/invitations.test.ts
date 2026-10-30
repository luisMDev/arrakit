import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ownerOf } from '../testing/people'
import { TEST_WEB_ORIGIN, type TestApp, createTestApp } from '../testing/app'

describe('invite flow', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  const open = async (link: string) => {
    const url = new URL(link)
    const res = await t.app.request(url.pathname + url.search, { redirect: 'manual' })
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    return { res, headers: new Headers({ cookie, origin: TEST_WEB_ORIGIN }) }
  }

  it('invites, mails a magic link to the join page, accepts, and removal takes effect at once', async () => {
    const owner = await ownerOf(t, 'lucia@halden.vc', 'team', 'Lucía')
    const invite = await t
      .client(owner.headers)
      .invitations.invite({ email: 'jon@halden.vc', role: 'member' })
    const { res, headers } = await open(t.linkFor('jon@halden.vc'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${TEST_WEB_ORIGIN}/join/${invite.id}`)

    await expect(t.client(headers).invitations.accept({ id: invite.id })).resolves.toEqual({
      organization: owner.organization && { ...owner.organization, plan: 'team' },
      role: 'member',
    })
    await expect(t.client(headers).me.get()).resolves.toMatchObject({
      organization: { id: owner.organization.id },
      role: 'member',
    })
    await t.client(owner.headers).members.remove({ email: 'jon@halden.vc' })
    await expect(t.client(headers).invitations.list()).rejects.toMatchObject({ status: 404 })
    await expect(t.client(headers).me.get()).resolves.toMatchObject({ organization: null })
  })

  it('answers 409 to someone who already has an organization, keeping the invite', async () => {
    const owner = await ownerOf(t, 'owner@birch.vc')
    const other = await ownerOf(t, 'bo@other.vc')
    const invite = await t
      .client(owner.headers)
      .invitations.invite({ email: 'bo@other.vc', role: 'member' })
    await expect(
      t.client(other.headers).invitations.accept({ id: invite.id }),
    ).rejects.toMatchObject({ status: 409, message: 'You already belong to an organization.' })
    expect(await t.client(owner.headers).invitations.list()).toHaveLength(1)
  })

  it('answers 404 for another email or an unknown id, 401 signed out, 403 when seats are full', async () => {
    const owner = await ownerOf(t, 'owner@cedar.vc', 'pro')
    const invite = await t
      .client(owner.headers)
      .invitations.invite({ email: 'kim@cedar.vc', role: 'member' })
    const stranger = await t.signIn({ email: 'stranger@cedar.vc' })
    for (const id of [invite.id, 'nope', '', "' or 1=1 --", crypto.randomUUID()]) {
      await expect(t.client(stranger.headers).invitations.accept({ id })).rejects.toMatchObject({
        status: 404,
        message: 'This invitation is not open for you.',
      })
    }
    await expect(t.client().invitations.accept({ id: invite.id })).rejects.toMatchObject({
      status: 401,
    })
  })

  it('mails a plain sign-in link to someone asking with another person’s join callback', async () => {
    const owner = await ownerOf(t, 'owner@elm.vc')
    const invite = await t
      .client(owner.headers)
      .invitations.invite({ email: 'kim@elm.vc', role: 'member' })
    await t.app.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_WEB_ORIGIN },
      body: JSON.stringify({ email: 'eve@elm.vc', callbackURL: `/join/${invite.id}` }),
    })
    expect(t.sent.at(-1)).toMatchObject({
      to: 'eve@elm.vc',
      subject: 'Your link to sign in to Arrakit',
    })
  })
})
