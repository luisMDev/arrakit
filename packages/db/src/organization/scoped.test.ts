import { type SQL, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type Database, transaction } from '../connection'
import { isInsufficientPrivilege } from '../errors'
import { workspaces } from '../schema/index'
import { type TestData, insertOrganization, memberClaims, openTestData } from '../testing'
import { scopedTo } from './scoped'

async function first<T>(db: Database, query: SQL): Promise<T | undefined> {
  const { rows } = (await db.execute(query)) as unknown as { rows: T[] }
  return rows[0]
}

describe('scopedTo', () => {
  let data: TestData
  let organizationId: string
  let otherOrganizationId: string
  const userId = 'f2d4a7e0-0000-4000-8000-000000000001'

  beforeAll(async () => {
    data = await openTestData()
    organizationId = (await insertOrganization(data, { slug: 'scoped' })).id
    otherOrganizationId = (await insertOrganization(data, { slug: 'other' })).id
    await data.db.insert(workspaces).values([
      { organizationId, name: 'Mine' },
      { organizationId: otherOrganizationId, name: 'Theirs' },
    ])
  })
  afterAll(() => data.close())

  const session = async () => {
    const row = await first<{ role: string; claims: string | null; via: string | null }>(
      data.db,
      sql`select current_setting('role') as role, current_setting('request.jwt.claims', true) as claims, current_setting('app.via', true) as via`,
    )
    return row!
  }

  it('sets the claims and the role only inside the transaction', async () => {
    const claims = memberClaims(organizationId, userId, ['workspace:create'])
    const seen = await scopedTo(
      data.db,
      claims,
    )(async (tx) => {
      return first<{ role: string; jwt: unknown; via: string }>(
        tx,
        sql`select current_setting('role') as role, auth.jwt() as jwt, current_setting('app.via', true) as via`,
      )
    })
    expect(seen).toEqual({ role: 'authenticated', jwt: claims, via: 'server' })
    const after = await session()
    expect(after.role).toBe('none')
    expect(after.claims ?? '').toBe('')
    expect(after.via ?? '').toBe('')
  })

  it('returns the result of the work', async () => {
    await expect(
      scopedTo(data.db, memberClaims(organizationId, userId))(async () => 42),
    ).resolves.toBe(42)
  })

  it('rolls the writes back when the work throws', async () => {
    const scoped = scopedTo(data.db, memberClaims(organizationId, userId, ['workspace:create']))
    await expect(
      scoped(async (tx) => {
        await tx.insert(workspaces).values({ organizationId, name: 'Rolled back' })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    const rows = await data.db.select().from(workspaces).where(eq(workspaces.name, 'Rolled back'))
    expect(rows).toEqual([])
  })

  it('keeps role and claims in a nested transaction, and RLS after one fails', async () => {
    const claims = memberClaims(organizationId, userId, ['workspace:create'])
    const result = await scopedTo(
      data.db,
      claims,
    )(async (tx) => {
      const nested = await transaction(tx, (inner) =>
        first<{ role: string; jwt: unknown }>(
          inner,
          sql`select current_setting('role') as role, auth.jwt() as jwt`,
        ),
      )
      const refusal = await transaction(tx, (inner) =>
        inner.insert(workspaces).values({ organizationId: otherOrganizationId, name: 'Elsewhere' }),
      ).catch((err: unknown) => err)
      const after = await first<{ role: string }>(tx, sql`select current_setting('role') as role`)
      const visible = await tx
        .select({ organizationId: workspaces.organizationId })
        .from(workspaces)
      const secondRefusal = await transaction(tx, (inner) =>
        inner.insert(workspaces).values({ organizationId: otherOrganizationId, name: 'Again' }),
      ).catch((err: unknown) => err)
      return { nested, refusal, after, visible, secondRefusal }
    })
    expect(result.nested).toEqual({ role: 'authenticated', jwt: claims })
    expect(isInsufficientPrivilege(result.refusal)).toBe(true)
    expect(result.after?.role).toBe('authenticated')
    expect(result.visible).toEqual([{ organizationId }])
    expect(isInsufficientPrivilege(result.secondRefusal)).toBe(true)
  })
})
