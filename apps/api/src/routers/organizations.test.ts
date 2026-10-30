import type { Data } from '@arrakit/db'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { StripeGateway } from '../billing/stripe-gateway'
import { joined, ownerOf, sqlOf } from '../organizations/testing'
import { type TestApp, createTestApp } from '../testing/app'

function endingStripe() {
  const ended: string[] = []
  let failure: Error | null = null
  const gateway = {
    async endNow(subscriptionId: string) {
      if (failure) throw failure
      ended.push(subscriptionId)
    },
  } as unknown as StripeGateway
  return { gateway, ended, failNext: (err: Error) => void (failure = err) }
}

describe('organizations', () => {
  let t: TestApp
  const stripe = endingStripe()

  beforeAll(async () => {
    t = await createTestApp({ stripe: stripe.gateway })
  })
  afterAll(() => t.close())
  afterEach(() => vi.restoreAllMocks())

  const subscribe = (organizationId: string, subscriptionId: string) =>
    sqlOf(t)('update organizations set stripe_subscription_id = $1 where id = $2', [
      subscriptionId,
      organizationId,
    ])

  describe('rename', () => {
    it('renames for an admin, keeping the slug and ignoring body ids', async () => {
      const owner = await ownerOf(t, 'owner@alder.vc')
      const admin = await joined(t, owner, 'ana@alder.vc', 'admin')
      const renamed = await t
        .client(admin.headers)
        .organizations.update({ name: '  Alder Capital ', slug: 'x' } as { name: string })
      expect(renamed).toEqual({ ...owner.organization, name: 'Alder Capital', plan: 'team' })
      await expect(t.client(owner.headers).me.get()).resolves.toMatchObject({
        organization: { name: 'Alder Capital', slug: 'alder' },
      })
    })

    it('refuses blanks and empty bodies with 400, members with 403, no organization 404', async () => {
      const owner = await ownerOf(t, 'owner@birch.vc')
      const member = await joined(t, owner, 'marta@birch.vc')
      const api = t.client(owner.headers)
      for (const body of [{}, { name: '' }, { name: '   ' }]) {
        await expect(api.organizations.update(body)).rejects.toMatchObject({ status: 400 })
      }
      await expect(
        t.client(member.headers).organizations.update({ name: 'Mine' }),
      ).rejects.toMatchObject({ status: 403 })
      const loner = await t.signIn({ email: 'loner@birch.vc' })
      await expect(
        t.client(loner.headers).organizations.update({ name: 'Mine' }),
      ).rejects.toMatchObject({ status: 404 })
      await expect(t.client().organizations.update({ name: 'Mine' })).rejects.toMatchObject({
        status: 401,
      })
      expect((await api.me.get()).organization?.name).toBe('Birch')
    })
  })

  describe('delete', () => {
    it('deletes for the owner, queues the purge, and leaves everyone without an organization', async () => {
      const owner = await ownerOf(t, 'owner@cedar.vc')
      const member = await joined(t, owner, 'marta@cedar.vc')
      const other = await ownerOf(t, 'owner@other.vc')
      t.data.jobs.sent.splice(0)
      await t.client(owner.headers).organizations.delete()
      expect(t.data.jobs.sent).toEqual([
        expect.objectContaining({
          name: 'storage-purge',
          data: { organizationId: owner.organization.id, folder: '' },
        }),
      ])
      for (const person of [owner, member]) {
        await expect(t.client(person.headers).me.get()).resolves.toMatchObject({
          organization: null,
          role: null,
        })
      }
      await expect(t.client(other.headers).me.get()).resolves.toMatchObject({
        organization: { id: other.organization.id },
      })
      await expect(
        t.client(owner.headers).organizations.create({ name: 'Again', termsAccepted: true }),
      ).resolves.toMatchObject({ name: 'Again' })
      expect((await t.client(owner.headers).me.get()).role).toBe('owner')
    })

    it('refuses an admin or a member with 403, deleting and queueing nothing', async () => {
      const owner = await ownerOf(t, 'owner@elm.vc')
      const admin = await joined(t, owner, 'ana@elm.vc', 'admin')
      t.data.jobs.sent.splice(0)
      await expect(t.client(admin.headers).organizations.delete()).rejects.toMatchObject({
        status: 403,
        message: "Only the organization's owner can do this.",
      })
      expect(t.data.jobs.sent).toEqual([])
      expect((await t.client(owner.headers).me.get()).organization).not.toBeNull()
    })

    it('ends the Stripe subscription first; a Stripe failure answers 502 and deletes nothing', async () => {
      const owner = await ownerOf(t, 'owner@fir.vc')
      await subscribe(owner.organization.id, 'sub_fir')
      const errors = t.errorLog()
      stripe.failNext(new Error('stripe down'))
      await expect(t.client(owner.headers).organizations.delete()).rejects.toMatchObject({
        status: 502,
        message:
          "Couldn't cancel your plan with Stripe, so nothing was deleted. Try again in a minute.",
      })
      expect(errors()).toEqual([
        expect.objectContaining({
          msg: 'ending the subscription failed',
          organizationId: owner.organization.id,
          subscriptionId: 'sub_fir',
          err: expect.objectContaining({ message: 'stripe down' }),
        }),
      ])
      expect((await t.client(owner.headers).me.get()).organization).not.toBeNull()

      stripe.failNext(null as unknown as Error)
      await t.client(owner.headers).organizations.delete()
      expect(stripe.ended).toContain('sub_fir')
    })

    it('still answers 204 when the purge cannot be queued', async () => {
      const owner = await ownerOf(t, 'owner@hazel.vc')
      const errors = t.errorLog()
      vi.spyOn(t.data.jobs as Data['jobs'], 'send').mockRejectedValueOnce(new Error('queue down'))
      await expect(t.client(owner.headers).organizations.delete()).resolves.toBeUndefined()
      expect(errors()[0]).toMatchObject({ organizationId: owner.organization.id })
    })
  })

  it('answers 503 when a paying organization is deleted with no Stripe configured', async () => {
    const bare = await createTestApp()
    try {
      const owner = await ownerOf(bare, 'owner@ivy.vc')
      await sqlOf(bare)('update organizations set stripe_subscription_id = $1 where id = $2', [
        'sub_ivy',
        owner.organization.id,
      ])
      await expect(bare.client(owner.headers).organizations.delete()).rejects.toMatchObject({
        status: 503,
      })
    } finally {
      await bare.close()
    }
  })

  it('keeps the Better Auth organization routes closed', async () => {
    const owner = await ownerOf(t, 'owner@kale.vc')
    for (const [method, path] of [
      ['POST', '/api/auth/organization/create'],
      ['POST', '/api/auth/organization/update'],
      ['GET', '/api/auth/organization/list'],
    ] as const) {
      const res = await t.app.request(path, {
        method,
        headers: { ...Object.fromEntries(owner.headers), 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ name: 'X', slug: 'x' }) } : {}),
      })
      expect(res.status).toBe(404)
    }
  })
})
