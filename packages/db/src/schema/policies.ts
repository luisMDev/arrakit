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

type Gate = SQL | true

/**
 * The policies of a tenant table: reads need only the tenant predicate, and each write command
 * listed in `writes` needs the tenant predicate and its gate. A command left out has no policy,
 * so it is denied.
 */
export function tenantPolicies(
  table: string,
  tenant: SQL,
  writes: { insert?: Gate; update?: Gate; delete?: Gate } = {},
): PgPolicy[] {
  const guarded = (gate: Gate) => (gate === true ? tenant : sql`${tenant} and ${gate}`)
  const policies = [
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
