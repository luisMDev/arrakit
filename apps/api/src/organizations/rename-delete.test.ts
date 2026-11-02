import type { Data } from '@arrakit/db'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { StripeGateway } from '../billing/stripe-gateway'
import { type TestApp, createTestApp } from '../testing/app'
import { createOrganization, joined, orgApi, ownerOf, sqlOf } from '../testing/people'

function endingStripe() {
  const ended: string[] = []
  let failure: Error | null = null
  const gateway = {
    async endNow(subscriptionId: string) {
      if (failure) throw failure
      ended.push(subscriptionId)
    },
  } as unknown as StripeGateway
  return { gateway, ended, failNext: (err: Error | null) => void (failure = err) }
}

describe('organization rename and delete (Better Auth organization plugin)', () => {
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

  const rename = (headers: Headers, organizationId: string, data: Record<string, unknown>) =>
    orgApi(t, headers).post('update', { organizationId, data })

  const remove = (headers: Headers, organizationId: string) =>
    orgApi(t, headers).post('delete', { organizationId })

  describe('rename', () => {
    it('renames trimmed for an admin, keeping the slug', async () => {
      const owner = await ownerOf(t, 'owner@alder.vc')
      const admin = await joined(t, owner, 'ana@alder.vc', 'admin')
      const renamed = await rename(admin.headers, owner.organizationId, {
        name: '  Alder Capital ',
      })
      expect(renamed).toMatchObject({
        status: 200,
        body: { name: 'Alder Capital', slug: 'alder', plan: 'team' },
      })
      await expect(t.client(owner.headers).me.get()).resolves.toMatchObject({
        organization: { name: 'Alder Capital', slug: 'alder' },
      })
    })

    it('refuses a blank name, a slug or a logo with 400 and a member with 403', async () => {
      const owner = await ownerOf(t, 'owner@birch.vc')
      const member = await joined(t, owner, 'marta@birch.vc')
      expect(await rename(owner.headers, owner.organizationId, { name: '   ' })).toMatchObject({
        status: 400,
        body: { message: 'Give the organization a name.' },
      })
      for (const data of [
        { name: 'Birch', slug: 'mine' },
        { name: 'Birch', logo: 'x.png' },
      ]) {
        expect(await rename(owner.headers, owner.organizationId, data)).toMatchObject({
          status: 400,
          body: { message: 'Only the name changes.' },
        })
      }
      expect((await rename(member.headers, owner.organizationId, { name: 'Mine' })).status).toBe(
        403,
      )
      const outsider = await ownerOf(t, 'owner@other-birch.vc')
      expect((await rename(outsider.headers, owner.organizationId, { name: 'Mine' })).status).toBe(
        400,
      )
      expect((await t.client(owner.headers).me.get()).organization).toMatchObject({
        name: 'Birch',
        slug: 'birch',
      })
    })

    it('never takes a plan from the body', async () => {
      const owner = await ownerOf(t, 'owner@cherry.vc', 'free')
      await rename(owner.headers, owner.organizationId, { name: 'Cherry', plan: 'internal' })
      expect((await t.client(owner.headers).me.get()).plan).toBe('free')
    })
  })

  describe('delete', () => {
    it('deletes for the owner, revokes grants, queues the purge, and keeps other organizations', async () => {
      const owner = await ownerOf(t, 'owner@cedar.vc')
      const member = await joined(t, owner, 'marta@cedar.vc')
      const second = await createOrganization(t, owner.headers, 'Second Cedar')
      const revoke = vi.spyOn(t.data, 'revokeGrants')
      t.data.jobs.sent.splice(0)

      expect((await remove(owner.headers, owner.organizationId)).status).toBe(200)

      expect(revoke).toHaveBeenCalledWith(owner.organizationId)
      expect(t.data.jobs.sent).toEqual([
        expect.objectContaining({
          name: 'storage-purge',
          data: { organizationId: owner.organizationId, folder: '' },
        }),
      ])
      await expect(t.client(member.headers).me.get()).resolves.toMatchObject({
        organization: null,
        role: null,
      })
      await expect(t.client(owner.headers).me.get()).resolves.toMatchObject({
        organization: { id: second.id },
        role: 'owner',
      })
    })

    it('refuses an admin with 403, deleting and queueing nothing', async () => {
      const owner = await ownerOf(t, 'owner@elm.vc')
      const admin = await joined(t, owner, 'ana@elm.vc', 'admin')
      t.data.jobs.sent.splice(0)
      expect((await remove(admin.headers, owner.organizationId)).status).toBe(403)
      expect(t.data.jobs.sent).toEqual([])
      expect((await t.client(owner.headers).me.get()).organization).not.toBeNull()
    })

    it('ends the Stripe subscription first; a Stripe failure answers 502 and deletes nothing', async () => {
      const owner = await ownerOf(t, 'owner@fir.vc')
      await subscribe(owner.organizationId, 'sub_fir')
      stripe.failNext(new Error('stripe down'))
      expect(await remove(owner.headers, owner.organizationId)).toMatchObject({
        status: 502,
        body: { message: "Couldn't reach Stripe. Try again in a minute." },
      })
      expect((await t.client(owner.headers).me.get()).organization?.id).toBe(owner.organizationId)

      stripe.failNext(null)
      expect((await remove(owner.headers, owner.organizationId)).status).toBe(200)
      expect(stripe.ended).toContain('sub_fir')
    })

    it('keeps the organization active in the session when its delete is refused', async () => {
      const owner = await ownerOf(t, 'owner@larch.vc')
      const second = await createOrganization(t, owner.headers, 'Larch Two')
      await subscribe(second.id, 'sub_larch')
      stripe.failNext(new Error('stripe down'))
      expect((await remove(owner.headers, second.id)).status).toBe(502)
      stripe.failNext(null)

      const { rows } = await sqlOf(t)(
        'select active_organization_id from sessions where user_id = $1',
        [owner.userId],
      )
      expect(rows.map((row) => row.active_organization_id)).toEqual([second.id])
      expect((await t.client(owner.headers).me.get()).organization?.id).toBe(second.id)
    })

    it('still deletes when the purge cannot be queued, logging it', async () => {
      const owner = await ownerOf(t, 'owner@hazel.vc')
      const errors = t.errorLog()
      vi.spyOn(t.data.jobs as Data['jobs'], 'send').mockRejectedValueOnce(new Error('queue down'))
      expect((await remove(owner.headers, owner.organizationId)).status).toBe(200)
      expect(errors()[0]).toMatchObject({ organizationId: owner.organizationId })
    })
  })

  it('answers 503 when a paying organization is deleted with no Stripe configured', async () => {
    const bare = await createTestApp()
    try {
      const owner = await ownerOf(bare, 'owner@ivy.vc')
      await sqlOf(bare)('update organizations set stripe_subscription_id = $1 where id = $2', [
        'sub_ivy',
        owner.organizationId,
      ])
      expect(
        (await orgApi(bare, owner.headers).post('delete', { organizationId: owner.organizationId }))
          .status,
      ).toBe(503)
      expect((await bare.client(owner.headers).me.get()).organization).not.toBeNull()
    } finally {
      await bare.close()
    }
  })
})
