import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { OrganizationNameUnusableError } from '../errors'
import {
  invitations,
  members,
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  organizations,
  sessions,
  users,
} from '../schema/index'
import { type TestData, openTestData } from '../testing'

describe('organizations', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  const organizationWithOwner = async (slug: string) => {
    const owner = randomUUID()
    await data.db.insert(users).values({ id: owner, name: '', email: `owner@${slug}.vc` })
    const [row] = await data.db.insert(organizations).values({ name: slug, slug }).returning()
    await data.db.insert(members).values({ organizationId: row!.id, userId: owner, role: 'owner' })
    return { id: row!.id, owner }
  }

  const grant = async (userId: string, organizationId: string) => {
    const clientId = `client-${randomUUID()}`
    await data.db.insert(oauthClients).values({ id: clientId, clientId, redirectUris: [] })
    const refreshId = randomUUID()
    await data.db.insert(oauthRefreshTokens).values({
      id: refreshId,
      token: randomUUID(),
      clientId,
      userId,
      referenceId: organizationId,
      scopes: [],
    })
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
    return clientId
  }

  it('renames trimmed, keeps the slug, accepts names without slug characters, refuses blanks', async () => {
    const { id } = await organizationWithOwner('alder')
    const scope = data.forOrganization(id)
    expect(await scope.rename('  Alder Capital ')).toMatchObject({
      name: 'Alder Capital',
      slug: 'alder',
    })
    expect((await scope.rename('北京基金'))?.name).toBe('北京基金')
    expect((await scope.rename('&.!'))?.name).toBe('&.!')
    await expect(scope.rename('   ')).rejects.toBeInstanceOf(OrganizationNameUnusableError)
    expect((await scope.organization())?.name).toBe('&.!')
    expect(await data.forOrganization(randomUUID()).rename('Ghost')).toBeUndefined()
  })

  it('deletes an organization with its members, invitations and grants, keeping its people', async () => {
    const doomed = await organizationWithOwner('birch')
    const kept = await organizationWithOwner('cedar')
    await data.db.insert(invitations).values({
      organizationId: doomed.id,
      email: 'x@birch.vc',
      inviterId: doomed.owner,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    await data.db.insert(sessions).values({
      id: randomUUID(),
      token: randomUUID(),
      userId: doomed.owner,
      expiresAt: new Date(Date.now() + 86_400_000),
      activeOrganizationId: doomed.id,
    })
    const client = await grant(doomed.owner, doomed.id)
    await grant(kept.owner, kept.id)

    expect(await data.deleteOrganization(doomed.id.toUpperCase())).toBe(true)
    expect(await data.deleteOrganization(doomed.id)).toBe(false)
    expect(await data.memberOf(doomed.owner)).toBeNull()
    expect(await data.memberOf(kept.owner)).not.toBeNull()
    expect(
      await data.db.select().from(invitations).where(eq(invitations.organizationId, doomed.id)),
    ).toEqual([])
    expect(await data.db.select().from(users).where(eq(users.id, doomed.owner))).toHaveLength(1)
    const [owned] = await data.db.select().from(sessions).where(eq(sessions.userId, doomed.owner))
    expect(owned?.activeOrganizationId).toBeNull()
    for (const table of [oauthAccessTokens, oauthRefreshTokens, oauthConsents]) {
      expect(await data.db.select().from(table).where(eq(table.referenceId, doomed.id))).toEqual([])
      expect(await data.db.select().from(table).where(eq(table.referenceId, kept.id))).toHaveLength(
        1,
      )
    }
    expect(
      await data.db.select().from(oauthClients).where(eq(oauthClients.clientId, client)),
    ).toHaveLength(1)
  })

  it('refuses an id that is not a UUID before deleting anything', async () => {
    await expect(data.deleteOrganization('not-a-uuid')).rejects.toThrow(/not an organization id/)
    await expect(data.deleteOrganization('')).rejects.toThrow()
  })
})
