import { type SQL, sql } from 'drizzle-orm'
import { type AnyPgColumn, type PgPolicy, pgPolicy } from 'drizzle-orm/pg-core'
import { authenticatedRole } from 'drizzle-orm/supabase'

/** The row belongs to the organization of the claims. */
export function inOrganization(organizationId: AnyPgColumn): SQL {
  return sql`${organizationId} = (select app.org_id())`
}

/**
 * The claims carry `permission`. Policies are DDL and cannot take parameters, so the literal is
 * inlined: only constants written in schema files may reach this.
 */
export function holds(permission: `${string}:${string}`): SQL {
  return sql`(select app.has_permission('${sql.raw(permission)}'))`
}

/** Server work acting inside an organization, never a person. */
export const isSystem: SQL = sql`(select app.is_system())`

/** The row names the person of the claims in `userId`. */
export function isActor(userId: AnyPgColumn): SQL {
  return sql`${userId} = (select app.user_id())`
}

export function either(...conditions: SQL[]): SQL {
  return sql`(${sql.join(conditions, sql` or `)})`
}

/** Nothing passes: only the privileged connection, which bypasses RLS, reaches the table. */
export function noAccess(table: string): PgPolicy {
  return pgPolicy(`${table}_no_access`, {
    as: 'restrictive',
    for: 'all',
    to: 'public',
    using: sql`false`,
    withCheck: sql`false`,
  })
}

/**
 * Set by the API's scoped executor and by nothing a token can reach: a browser token that reaches
 * Postgres (Data API, Realtime, Storage) carries the same claims as the server path but not this.
 */
export const SERVER_PATH_SETTING = 'app.via'

/** The statement runs inside a transaction the data layer's scoped executor opened. */
export const viaServer: SQL = sql`coalesce((select current_setting('${sql.raw(SERVER_PATH_SETTING)}', true)), '') = 'server'`

/**
 * Rows are reached only through the server path, whatever the permissive policies allow. A token
 * carries the claims the permissive policies read, so it is refused here instead.
 */
export function serverOnly(table: string): PgPolicy {
  return pgPolicy(`${table}_server_only`, {
    as: 'restrictive',
    for: 'all',
    to: 'public',
    using: viaServer,
    withCheck: viaServer,
  })
}

type Gate = SQL | true

/**
 * The policies of a tenant table: reads need only the tenant predicate, and each write command
 * listed in `writes` needs the tenant predicate and its gate. A command left out has no policy,
 * so it is denied. Every command also needs the server path (`serverOnly`).
 */
export function tenantPolicies(
  table: string,
  tenant: SQL,
  writes: { insert?: Gate; update?: Gate; delete?: Gate } = {},
): PgPolicy[] {
  const guarded = (gate: Gate) => (gate === true ? tenant : sql`${tenant} and ${gate}`)
  const policies = [
    serverOnly(table),
    pgPolicy(`${table}_tenant_select`, { for: 'select', to: authenticatedRole, using: tenant }),
  ]
  if (writes.insert !== undefined) {
    policies.push(
      pgPolicy(`${table}_tenant_insert`, {
        for: 'insert',
        to: authenticatedRole,
        withCheck: guarded(writes.insert),
      }),
    )
  }
  if (writes.update !== undefined) {
    const expression = guarded(writes.update)
    policies.push(
      pgPolicy(`${table}_tenant_update`, {
        for: 'update',
        to: authenticatedRole,
        using: expression,
        withCheck: expression,
      }),
    )
  }
  if (writes.delete !== undefined) {
    policies.push(
      pgPolicy(`${table}_tenant_delete`, {
        for: 'delete',
        to: authenticatedRole,
        using: guarded(writes.delete),
      }),
    )
  }
  return policies
}
