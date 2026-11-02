import { members, organizations, users } from '@arrakit/db/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type TestApp, createTestApp } from '../testing/app'
import { authApi, createOrganization, joined, orgApi, ownerOf } from '../testing/people'

/** Profile's Next and Skip, and the shell's dialog: Better Auth's `organization/create`. */
describe('creating an organization', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  const signIn = async (email: string, name = '') => (await t.signIn({ email, name })).headers

  /** Profile's Next: the person's name first when typed, then the organization with the terms. */
  async function next(headers: Headers, name: string, personName?: string) {
    if (personName?.trim()) await authApi(t, headers).post('update-user', { name: personName })
    return createOrganization(t, headers, name)
  }

  const skip = (headers: Headers) => createOrganization(t, headers, '', {})

  const memberRow = async (organizationId: string) => {
    const rows = await t.data.db.select().from(members)
    return rows.find((row) => row.organizationId === organizationId)
  }

  const userNamed = async (email: string) => {
    const rows = await t.data.db.select().from(users)
    return rows.find((row) => row.email === email)?.name
  }

  it('answers me.get right after sign-in with no organization', async () => {
    const headers = await signIn('fresh@seaya.capital')
    expect(await t.client(headers).me.get()).toEqual({
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
    const headers = await signIn('ana@seaya.capital')
    const org = await next(headers, 'Seaya Ventures', 'Ana Ibarra')
    expect(org).toEqual({
      id: expect.any(String),
      name: 'Seaya Ventures',
      slug: 'seaya-ventures',
      plan: 'free',
    })
    const me = await t.client(headers).me.get()
    expect(me).toMatchObject({
      name: 'Ana Ibarra',
      organization: { name: 'Seaya Ventures', slug: 'seaya-ventures', plan: 'free' },
      role: 'owner',
      plan: 'free',
      seats: 1,
    })
    expect(me.permissions.organization).toEqual(['update', 'delete'])
    expect(me.permissions.billing).toEqual(['read', 'manage'])
  })

  it('stamps the terms, sets the person name and makes them owner', async () => {
    const headers = await signIn('lucia@alder.vc')
    const org = await next(headers, 'Alder Ventures', 'Lucía Gómez')
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
    expect(await next(await signIn(email), name)).toMatchObject({ name: orgName, slug })
  })

  it.each([
    ['ana.perez@gmail.com', '', 'Ana Pérez', 'Ana Pérez', 'ana-perez'],
    ['x@outlook.com', 'Marta Ruiz', '', 'Marta Ruiz', 'marta-ruiz'],
    ['bruno.diaz@hotmail.com', '', undefined, 'Bruno Diaz', 'bruno-diaz'],
  ])(
    'names a free-mail organization after the person (%s)',
    async (email, sessionName, personName, orgName, slug) => {
      const org = await next(await signIn(email, sessionName), '', personName)
      expect(org).toMatchObject({ name: orgName })
      expect(org.slug.startsWith(slug)).toBe(true)
    },
  )

  it('names it after the person when the domain has no label', async () => {
    const org = await next(await signIn('dana@co.uk'), '&.!', 'Lucía Gómez')
    expect(org.name).toBe('Lucía Gómez')
  })

  it('creates a second organization, makes it active and keeps the first', async () => {
    const headers = await signIn('twice@birch.vc')
    const first = await next(headers, 'First')
    const second = await next(headers, 'Second')
    expect((await t.client(headers).me.get()).organization?.id).toBe(second.id)
    expect((await memberRow(first.id))?.role).toBe('owner')
  })

  it.each([
    ['false', false],
    ['a string', 'true'],
  ])('refuses terms %s with 400 and creates nothing', async (_, termsAccepted) => {
    const headers = await signIn(`terms-${String(termsAccepted)}@maple.vc`)
    const refused = await orgApi(t, headers).post('create', {
      name: 'Maple',
      slug: 'maple',
      termsAccepted,
    })
    expect(refused).toMatchObject({
      status: 400,
      body: { message: 'Accept the Terms and the Privacy Policy.' },
    })
    expect((await t.client(headers).me.get()).organization).toBeNull()
  })

  it('ignores a client-sent termsAcceptedAt', async () => {
    const headers = await signIn('stamp@spruce.vc')
    const org = await createOrganization(t, headers, 'Spruce', {
      termsAccepted: true,
      termsAcceptedAt: '2000-01-01T00:00:00Z',
    })
    expect((await memberRow(org.id))?.termsAcceptedAt?.getFullYear()).not.toBe(2000)
  })

  it('gives same-named organizations numbered slugs', async () => {
    const slugs = []
    for (const email of ['a@one.vc', 'b@two.vc', 'c@three.vc']) {
      slugs.push((await next(await signIn(email), 'Alder')).slug)
    }
    expect(slugs).toEqual(['alder', 'alder-2', 'alder-3'])
  })

  it('answers 401 without a session', async () => {
    const refused = await orgApi(t, new Headers()).post('create', { name: 'X', slug: 'x' })
    expect(refused.status).toBe(401)
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
      const org = await createOrganization(fresh, headers, '', {})
      expect(org.name).toBe(orgName)
      expect(org.slug.startsWith(slug)).toBe(true)
      expect(org.slug).not.toMatch(/gmail|hotmail|outlook/)
    } finally {
      await fresh.close()
    }
  })

  it('skip records no terms', async () => {
    const org = await skip(await signIn('postmaster@hazel.vc'))
    expect(org.name).toBe('Hazel')
    expect((await memberRow(org.id))?.termsAcceptedAt).toBeNull()
  })

  it('stamps no terms on a seat added or joined later', async () => {
    const owner = await ownerOf(t, 'owner@rowan.vc')
    const added = await t.signIn({ email: 'added@rowan.vc' })
    await t.deps.auth.api.addMember({
      body: { userId: added.userId, organizationId: owner.organizationId, role: 'member' },
    })
    const invited = await joined(t, owner, 'invited@rowan.vc')
    const rows = await t.data.db.select().from(members)
    const seatOf = (userId: string) => rows.find((row) => row.userId === userId)
    expect(seatOf(owner.userId)?.termsAcceptedAt).toBeInstanceOf(Date)
    expect(seatOf(added.userId)).toMatchObject({ role: 'member', termsAcceptedAt: null })
    expect(seatOf(invited.userId)).toMatchObject({ role: 'member', termsAcceptedAt: null })
  })

  it('skips into another organization after Next, with a free slug', async () => {
    const headers = await signIn('nexter@poplar.vc')
    const first = await next(headers, 'Poplar')
    const skipped = await skip(headers)
    expect(skipped).toMatchObject({ name: 'Poplar', slug: 'poplar-2' })
    expect((await t.client(headers).me.get()).organization?.id).not.toBe(first.id)
  })

  it('ignores a slug the client sends', async () => {
    const created = await orgApi(t, await signIn('slug@quince.vc')).post<{ slug: string }>(
      'create',
      { name: 'Quince', slug: 'chosen-by-client' },
    )
    expect(created).toMatchObject({ status: 200, body: { slug: 'quince' } })
  })

  it('keeps organizations unique per slug across creates', async () => {
    const rows = await t.data.db.select().from(organizations)
    expect(new Set(rows.map((row) => row.slug)).size).toBe(rows.length)
  })
})
