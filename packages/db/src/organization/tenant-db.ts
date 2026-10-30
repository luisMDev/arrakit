import {
  type SQL,
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  getTableName,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  or,
} from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'

import type { Database } from '../connection'
import type { OrganizationId } from '../organization-id'

export const operators = { and, or, not, eq, ne, gt, gte, lt, lte, inArray, isNull, isNotNull }
export type Operators = typeof operators
export const orderOperators = { asc, desc }
export type OrderOperators = typeof orderOperators

export type TenantTable = PgTable & { organizationId: AnyPgColumn }
export type Where<T> = (table: T, ops: Operators) => SQL | undefined
export type OrderBy<T> = (table: T, ops: OrderOperators) => SQL | SQL[]
export type LockStrength = 'update' | 'no key update' | 'share' | 'key share'

type Row<T extends TenantTable> = T['$inferSelect']
type NewRow<T extends TenantTable> = Omit<T['$inferInsert'], 'organizationId'> & {
  organizationId?: string
}

export interface TenantTableDb<T extends TenantTable> {
  select(where?: Where<T>, orderBy?: OrderBy<T>): Promise<Row<T>[]>
  pick<K extends keyof Row<T> & string>(
    columns: K[],
    where?: Where<T>,
    orderBy?: OrderBy<T>,
  ): Promise<Pick<Row<T>, K>[]>
  insert(values: NewRow<T> | NewRow<T>[]): Promise<Row<T>[]>
  update(set: Partial<T['$inferInsert']>, where: Where<T>): Promise<Row<T>[]>
  delete(where: Where<T>): Promise<Row<T>[]>
  lock(where: Where<T>, strength: LockStrength): Promise<Row<T>[]>
}

export interface OrganizationDb {
  readonly organizationId: OrganizationId
  table<T extends PgTable>(table: T): T extends TenantTable ? TenantTableDb<T> : never
  transaction<R>(work: (tx: OrganizationDb) => Promise<R>): Promise<R>
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Drizzle's builders do not type generic tables. */
export function organizationDb(db: Database, organizationId: OrganizationId): OrganizationDb {
  function scoped<T extends TenantTable>(table: T): TenantTableDb<T> {
    const columns = getTableColumns(table)
    if (!('organizationId' in columns)) {
      throw new Error(
        `[data] ${getTableName(table)} has no organizationId column, so forOrganization() cannot scope it`,
      )
    }
    const own = eq(table.organizationId, organizationId)
    const filter = (where?: Where<T>) => (where ? and(own, where(table, operators)) : own)
    const required = (where: Where<T> | undefined) => {
      const condition = where?.(table, operators)
      if (!condition) throw new Error('[data] update, delete and lock need a where condition')
      return and(own, condition)
    }
    const ordered = (query: any, orderBy?: OrderBy<T>) => {
      if (!orderBy) return query
      const order = orderBy(table, orderOperators)
      return query.orderBy(...(Array.isArray(order) ? order : [order]))
    }

    return {
      select: (where, orderBy) =>
        ordered((db as any).select().from(table).where(filter(where)), orderBy),
      pick: (names, where, orderBy) => {
        const picked = Object.fromEntries(names.map((name) => [name, (columns as any)[name]]))
        return ordered((db as any).select(picked).from(table).where(filter(where)), orderBy)
      },
      insert: (values) => {
        const rows = (Array.isArray(values) ? values : [values]).map((row) => ({
          ...row,
          organizationId,
        }))
        return (db as any).insert(table).values(rows).returning()
      },
      update: async (set, where) => {
        const condition = required(where)
        const { organizationId: _ignored, ...rest } = set as Record<string, unknown>
        return (db as any).update(table).set(rest).where(condition).returning()
      },
      delete: async (where) => (db as any).delete(table).where(required(where)).returning(),
      lock: async (where, strength) =>
        (db as any).select().from(table).where(required(where)).for(strength),
    }
  }

  return {
    organizationId,
    table: ((table: TenantTable) => scoped(table)) as OrganizationDb['table'],
    transaction: (work) =>
      db.transaction((tx) => work(organizationDb(tx as unknown as Database, organizationId))),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
