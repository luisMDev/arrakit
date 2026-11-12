import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type TestApp, createTestApp } from '../testing/app'
import { createOrganization, joined, orgApi, ownerOf, sqlOf } from '../testing/people'

describe('the active organization', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  const activeOf = async (headers: Headers) => (await t.client(headers).me.get()).organization?.id

  it('switches what me, billing and usage read with set-active', async () => {
    const ana = await ownerOf(t, 'ana@alder.vc', 'free')
    const second = await createOrganization(t, ana.headers, 'Birch')
    await t.data.forOrganization(second.id).setPlan('team')
    expect(await activeOf(ana.headers)).toBe(second.id)
    await expect(t.client(ana.headers).billing.get()).resolves.toMatchObject({ plan: 'team' })

    const switched = await orgApi(t, ana.headers).post('set-active', {
      organizationId: ana.organizationId,
    })
    expect(switched.status).toBe(200)
    expect(await activeOf(ana.headers)).toBe(ana.organizationId)
    await expect(t.client(ana.headers).billing.get()).resolves.toMatchObject({ plan: 'free' })
    await expect(t.client(ana.headers).me.get()).resolves.toMatchObject({ plan: 'free', seats: 1 })
  })

  it('refuses switching to an organization the person is not in', async () => {
    const ana = await ownerOf(t, 'ana@cedar.vc')
    const other = await ownerOf(t, 'bo@cedar-other.vc')
    const refused = await orgApi(t, ana.headers).post('set-active', {
      organizationId: other.organizationId,
    })
    expect(refused.status).toBe(403)
    expect(await activeOf(ana.headers)).toBe(ana.organizationId)
  })

  it('falls back to the earliest organization when the active one is no longer theirs', async () => {
    const owner = await ownerOf(t, 'owner@elm.vc')
    const stranger = await ownerOf(t, 'owner@elm-other.vc')
    const member = await joined(t, owner, 'ana@elm.vc')
    expect(await activeOf(member.headers)).toBe(owner.organizationId)

    await sqlOf(t)(
      'update better_auth.sessions set active_organization_id = $1 where user_id = $2',
      [stranger.organizationId, member.userId],
    )
    await expect(t.client(member.headers).me.get()).resolves.toMatchObject({
      organization: { id: owner.organizationId },
      role: 'member',
    })
    await expect(t.client(member.headers).billing.get()).rejects.toMatchObject({ status: 403 })
  })

  it('answers 404 on the next call once a member is removed from their only organization', async () => {
    const owner = await ownerOf(t, 'owner@fir.vc')
    const member = await joined(t, owner, 'marta@fir.vc')
    await expect(t.client(member.headers).usage.get()).resolves.toBeDefined()
    await orgApi(t, owner.headers).post('remove-member', {
      organizationId: owner.organizationId,
      memberIdOrEmail: member.memberId,
    })
    await expect(t.client(member.headers).usage.get()).rejects.toMatchObject({ status: 404 })
  })

  it('starts a new session in the earliest organization joined', async () => {
    const first = await ownerOf(t, 'ana@hazel.vc')
    await createOrganization(t, first.headers, 'Later')
    const again = await t.signIn({ email: 'ana@hazel.vc' })
    const { rows } = await sqlOf(t)(
      'select active_organization_id from better_auth.sessions where token = $1',
      [again.headers.get('cookie')!.match(/session_token=([^.;]+)/)![1]],
    )
    expect(rows[0]?.active_organization_id).toBe(first.organizationId)
    expect(await activeOf(again.headers)).toBe(first.organizationId)
  })
})
