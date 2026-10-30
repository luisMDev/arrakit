import { members, organizations, users } from '@arrakit/db/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type TestApp, createTestApp } from '../testing/app'
import { orgApi } from '../testing/people'

describe('onboarding.create / onboarding.skip / me.get', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  const as = async (email: string, name = '') => t.client((await t.signIn({ email, name })).headers)

  const memberRow = async (organizationId: string) => {
    const rows = await t.data.db.select().from(members)
    return rows.find((row) => row.organizationId === organizationId)
  }

  const userNamed = async (email: string) => {
    const rows = await t.data.db.select().from(users)
    return rows.find((row) => row.email === email)?.name
  }

  it('answers me.get right after sign-in with no organization', async () => {
    const client = await as('fresh@seaya.capital')
    expect(await client.me.get()).toEqual({
      email: 'fresh@seaya.capital',
      name: '',
      language: 'en',
      organization: null,
      role: null,
      permissions: {},
      plan: null,
      seats: null,
    })
  })

  it('creates the organization on Next and shows it in me.get', async () => {
    const client = await as('ana@seaya.capital')
    const org = await client.onboarding.create({
      name: 'Seaya Ventures',
      personName: 'Ana Ibarra',
      termsAccepted: true,
    })
    expect(org).toEqual({
      id: expect.any(String),
      name: 'Seaya Ventures',
      slug: 'seaya-ventures',
      plan: 'free',
    })
    expect(await client.me.get()).toMatchObject({
      name: 'Ana Ibarra',
      organization: { name: 'Seaya Ventures', slug: 'seaya-ventures', plan: 'free' },
      role: 'owner',
      plan: 'free',
      seats: 1,
    })
    const { permissions } = await client.me.get()
    expect(permissions.organization).toEqual(['update', 'delete'])
    expect(permissions.billing).toEqual(['read', 'manage'])
  })

  it('stamps the terms, sets the person name and makes them owner', async () => {
    const client = await as('lucia@alder.vc')
    const org = await client.onboarding.create({
      name: 'Alder Ventures',
      personName: 'Lucía Gómez',
      termsAccepted: true,
    })
    expect(org).toMatchObject({ name: 'Alder Ventures', slug: 'alder-ventures', plan: 'free' })
    const member = await memberRow(org.id)
    expect(member?.role).toBe('owner')
    expect(member?.termsAcceptedAt).not.toBeNull()
    expect(await userNamed('lucia@alder.vc')).toBe('Lucía Gómez')
  })

  it.each([
    ['', 'dana@elm.vc', 'Elm', 'elm'],
    ['   ', 'dana@oak-partners.com', 'Oak Partners', 'oak-partners'],
    ['&.!', 'dana@mail.yew.co.uk', 'Yew', 'yew'],
    ['北京基金', 'dana@pine.vc', 'Pine', 'pine'],
  ])('falls back from %j to the domain of %s', async (name, email, orgName, slug) => {
    const client = await as(email)
    expect(await client.onboarding.create({ name, termsAccepted: true })).toMatchObject({
      name: orgName,
      slug,
    })
  })

  it.each([
    ['ana.perez@gmail.com', '', 'Ana Pérez', 'Ana Pérez', 'ana-perez'],
    ['x@outlook.com', 'Marta Ruiz', '', 'Marta Ruiz', 'marta-ruiz'],
    ['bruno.diaz@hotmail.com', '', undefined, 'Bruno Diaz', 'bruno-diaz'],
  ])(
    'names a free-mail organization after the person (%s)',
    async (email, sessionName, personName, orgName, slug) => {
      const client = await as(email, sessionName)
      const org = await client.onboarding.create({
        name: '',
        ...(personName === undefined ? {} : { personName }),
        termsAccepted: true,
      })
      expect(org).toMatchObject({ name: orgName })
      expect(org.slug.startsWith(slug)).toBe(true)
    },
  )

  it('names it after personName when the domain has no label', async () => {
    const client = await as('dana@co.uk')
    const org = await client.onboarding.create({
      name: '&.!',
      personName: 'Lucía Gómez',
      termsAccepted: true,
    })
    expect(org.name).toBe('Lucía Gómez')
  })

  it('creates a second organization, makes it active and keeps the first', async () => {
    const client = await as('twice@birch.vc')
    const first = await client.onboarding.create({ name: 'First', termsAccepted: true })
    const second = await client.onboarding.create({ name: 'Second', termsAccepted: true })
    expect((await client.me.get()).organization?.id).toBe(second.id)
    expect((await memberRow(first.id))?.role).toBe('owner')
  })

  it.each([
    ['false', false],
    ['missing', undefined],
    ['a string', 'true'],
  ])('refuses terms %s with 400 and creates nothing', async (_, termsAccepted) => {
    const client = await as(`terms-${String(termsAccepted)}@maple.vc`)
    await expect(
      client.onboarding.create({ name: 'Maple', termsAccepted } as never),
    ).rejects.toMatchObject({ status: 400 })
    expect((await client.me.get()).organization).toBeNull()
  })

  it('ignores a client-sent termsAcceptedAt', async () => {
    const client = await as('stamp@spruce.vc')
    const org = await client.onboarding.create({
      name: 'Spruce',
      termsAccepted: true,
      termsAcceptedAt: '2000-01-01T00:00:00Z',
    } as never)
    const member = await memberRow(org.id)
    expect(member?.termsAcceptedAt?.getFullYear()).not.toBe(2000)
  })

  it('gives same-named organizations numbered slugs', async () => {
    const slugs = []
    for (const email of ['a@one.vc', 'b@two.vc', 'c@three.vc']) {
      const client = await as(email)
      slugs.push((await client.onboarding.create({ name: 'Alder', termsAccepted: true })).slug)
    }
    expect(slugs).toEqual(['alder', 'alder-2', 'alder-3'])
  })

  it('answers 401 without a session', async () => {
    await expect(
      t.client().onboarding.create({ name: 'X', termsAccepted: true }),
    ).rejects.toMatchObject({ status: 401 })
    await expect(t.client().onboarding.skip()).rejects.toMatchObject({ status: 401 })
    await expect(t.client().me.get()).rejects.toMatchObject({ status: 401 })
  })

  it.each([
    ['lucia@alder-skip.vc', '', 'Alder Skip', 'alder-skip'],
    ['x@mail.cedar.co.uk', '', 'Cedar', 'cedar'],
    ['x@birch-ventures.com', '', 'Birch Ventures', 'birch-ventures'],
    ['x@team.rowan.com.au', '', 'Rowan', 'rowan'],
    ['x@info.co.uk', '', 'Info', 'info'],
    ['ana.perez@gmail.com', '', 'Ana Perez', 'ana-perez'],
    ['_@gmail.com', '', 'My Organization', 'my-organization'],
    ['sara@oak.vc', 'Sara Gil', 'Oak', 'oak'],
    ['x@co.uk', 'Ana Pérez', 'Ana Pérez', 'ana'],
  ])('skip names %s (session name %j) %j', async (email, name, orgName, slug) => {
    const fresh = await createTestApp()
    try {
      const { headers } = await fresh.signIn({ email, name })
      const org = await fresh.client(headers).onboarding.skip()
      expect(org.name).toBe(orgName)
      expect(org.slug.startsWith(slug)).toBe(true)
      expect(org.slug).not.toMatch(/gmail|hotmail|outlook/)
    } finally {
      await fresh.close()
    }
  })

  it('skip ignores any body and records no terms', async () => {
    const { headers } = await t.signIn({ email: 'postmaster@hazel.vc' })
    const res = await t.app.request('/api/rpc/onboarding/skip', {
      method: 'POST',
      headers: { ...Object.fromEntries(headers.entries()), 'content-type': 'application/json' },
      body: JSON.stringify({ json: { name: 'Postmaster', termsAccepted: true } }),
    })
    expect(res.status).toBe(200)
    const { json } = (await res.json()) as { json: { id: string; name: string } }
    expect(json.name).toBe('Hazel')
    expect((await memberRow(json.id))?.termsAcceptedAt).toBeNull()
  })

  it('skips into another organization after Next, with a free slug', async () => {
    const client = await as('nexter@poplar.vc')
    const first = await client.onboarding.create({ name: 'Poplar', termsAccepted: true })
    const skipped = await client.onboarding.skip()
    expect(skipped).toMatchObject({ name: 'Poplar', slug: 'poplar-2' })
    expect((await client.me.get()).organization?.id).not.toBe(first.id)
  })

  it('ignores a slug the client sends to Better Auth', async () => {
    const { headers } = await t.signIn({ email: 'slug@quince.vc' })
    const created = await orgApi(t, headers).post<{ slug: string }>('create', {
      name: 'Quince',
      slug: 'chosen-by-client',
    })
    expect(created).toMatchObject({ status: 200, body: { slug: 'quince' } })
  })

  it('keeps organizations unique per slug across creates', async () => {
    const rows = await t.data.db.select().from(organizations)
    expect(new Set(rows.map((row) => row.slug)).size).toBe(rows.length)
  })
})
