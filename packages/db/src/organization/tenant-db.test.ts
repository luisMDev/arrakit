import { sql } from 'drizzle-orm'
import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { organizations } from '../schema/index'
import { type TestData, openTestData } from '../testing'

const tenancyProbe = pgTable('tenancy_probe', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
})

describe('forOrganization (tenant db)', () => {
  let data: TestData
  let a: string
  let b: string

  beforeAll(async () => {
    data = await openTestData()
    await data.db.execute(sql`
      create table tenancy_probe (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null references organizations(id) on delete cascade,
        label text not null
      )`)
    const rows = await data.db
      .insert(organizations)
      .values([
        { name: 'A', slug: 'tenant-a' },
        { name: 'B', slug: 'tenant-b' },
      ])
      .returning()
    a = rows[0]!.id
    b = rows[1]!.id
    await data
      .forOrganization(a)
      .table(tenancyProbe)
      .insert([{ label: 'a1' }, { label: 'a2' }])
    await data.forOrganization(b).table(tenancyProbe).insert({ label: 'b1' })
  })
  afterAll(() => data.close())

  const probeOf = (id: string) => data.forOrganization(id).table(tenancyProbe)
  const labels = async (id: string) =>
    (await probeOf(id).select(undefined, (t, { asc }) => asc(t.label))).map((row) => row.label)

  it('selects only its own rows, with or without a condition', async () => {
    expect(await labels(a)).toEqual(['a1', 'a2'])
    expect(await labels(b)).toEqual(['b1'])
    expect(await probeOf(a).select((t, { eq }) => eq(t.label, 'b1'))).toEqual([])
  })

  it('picks named columns and may order by another', async () => {
    const picked = await probeOf(a).pick(['label'], undefined, (t, { desc }) => desc(t.label))
    expect(picked).toEqual([{ label: 'a2' }, { label: 'a1' }])
  })

  it('stores an insert naming another organization under its own', async () => {
    const [row] = await probeOf(a).insert({ label: 'sneaky', organizationId: b })
    expect(row?.organizationId).toBe(a)
    expect(await probeOf(b).select((t, { eq }) => eq(t.label, 'sneaky'))).toEqual([])
    await probeOf(a).delete((t, { eq }) => eq(t.label, 'sneaky'))
  })

  it('updates and deletes only its own rows and ignores organizationId in set', async () => {
    const updated = await probeOf(a).update({ label: 'x', organizationId: b }, (t, { inArray }) =>
      inArray(t.label, ['a1', 'b1']),
    )
    expect(updated.map((row) => [row.label, row.organizationId])).toEqual([['x', a]])
    expect(await labels(b)).toEqual(['b1'])

    expect(await probeOf(a).delete((t, { eq }) => eq(t.label, 'b1'))).toEqual([])
    expect(await labels(b)).toEqual(['b1'])
    await probeOf(a).update({ label: 'a1' }, (t, { eq }) => eq(t.label, 'x'))
  })

  it('refuses update, delete and lock without a where condition', async () => {
    const message = '[data] update, delete and lock need a where condition'
    await expect(probeOf(a).update({ label: 'z' }, () => undefined)).rejects.toThrow(message)
    await expect(probeOf(a).delete(() => undefined)).rejects.toThrow(message)
    await expect(probeOf(a).lock(() => undefined, 'update')).rejects.toThrow(message)
    expect(await labels(a)).toEqual(['a1', 'a2'])
  })

  it('locks only its own rows', async () => {
    const locked = await data
      .forOrganization(a)
      .transaction((tx) =>
        tx.table(tenancyProbe).lock((t, { isNotNull }) => isNotNull(t.label), 'share'),
      )
    expect(locked.map((row) => row.label).sort()).toEqual(['a1', 'a2'])
  })

  it('commits a transaction and rolls it back on throw', async () => {
    await data.forOrganization(a).transaction(async (tx) => {
      await tx.table(tenancyProbe).insert({ label: 'committed' })
    })
    await expect(
      data.forOrganization(a).transaction(async (tx) => {
        await tx.table(tenancyProbe).insert({ label: 'rolled back' })
        throw new Error('nope')
      }),
    ).rejects.toThrow('nope')
    expect(await labels(a)).toEqual(['a1', 'a2', 'committed'])
  })

  it('refuses a table without organizationId and a non-UUID organization', () => {
    expect(() => data.forOrganization(a).table(organizations as never)).toThrow(
      '[data] organizations has no organizationId column, so forOrganization() cannot scope it',
    )
    for (const id of ['', 'undefined', '*', `${a}/`]) {
      expect(() => data.forOrganization(id)).toThrow('[data] not an organization id')
    }
  })

  it('accepts an uppercase organization id', async () => {
    expect(await labels(a.toUpperCase())).toEqual(await labels(a))
    expect((await data.forOrganization(a.toUpperCase()).organization())?.name).toBe('A')
  })
})
