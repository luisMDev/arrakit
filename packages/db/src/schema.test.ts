import { type SQL, getTableColumns, getTableName, isTable } from 'drizzle-orm'
import { PgDialect, type PgTable, getTableConfig } from 'drizzle-orm/pg-core'
import { authenticatedRole } from 'drizzle-orm/supabase'
import { describe, expect, it } from 'vitest'

import * as schema from './schema/index'

const tables = Object.values(schema as Record<string, unknown>).filter((value): value is PgTable =>
  isTable(value),
)
const exceptions: readonly string[] = schema.TENANCY_EXCEPTIONS

function hasOrganizationId(table: PgTable) {
  const column = (getTableColumns(table) as Record<string, { name: string; notNull: boolean }>)
    .organizationId
  return column?.name === 'organization_id' && column.notNull
}

describe('schema tenancy rule', () => {
  it('gives every table but the exceptions an organization_id', () => {
    const offenders = tables
      .filter((table) => !exceptions.includes(getTableName(table)))
      .filter((table) => !hasOrganizationId(table))
      .map(getTableName)
    expect(offenders).toEqual([])
  })

  it('still refuses new tables without it', () => {
    for (const name of ['user_profiles', 'auth_events', 'user', 'organization']) {
      expect(exceptions).not.toContain(name)
    }
  })

  it('keeps the identity and OAuth tables, and only them, in the better_auth schema', () => {
    const inBetterAuth = tables
      .filter((table) => getTableConfig(table).schema === 'better_auth')
      .map(getTableName)
    expect(inBetterAuth.sort()).toEqual([
      'accounts',
      'jwks',
      'oauth_access_tokens',
      'oauth_client_assertions',
      'oauth_client_resources',
      'oauth_clients',
      'oauth_consents',
      'oauth_refresh_tokens',
      'oauth_resources',
      'sessions',
      'users',
      'verifications',
    ])
  })

  it('declares the OAuth provider tables', () => {
    const names = tables.map(getTableName)
    for (const name of ['jwks', 'oauth_clients', 'oauth_access_tokens', 'oauth_consents']) {
      expect(names).toContain(name)
    }
  })
})

describe('schema row level security', () => {
  const dialect = new PgDialect()
  const render = (expression: SQL) => dialect.sqlToQuery(expression).sql
  const tenantTables = tables.filter((table) => !exceptions.includes(getTableName(table)))

  it('turns RLS on for every table', () => {
    const offenders = tables
      .filter((table) => {
        const config = getTableConfig(table)
        return !config.enableRLS && config.policies.length === 0
      })
      .map(getTableName)
    expect(tables).toHaveLength(25)
    expect(offenders).toEqual([])
  })

  it('gives every tenant table a tenant select policy', () => {
    const offenders = tenantTables
      .filter((table) => {
        const name = getTableName(table)
        return !getTableConfig(table).policies.some(
          (policy) => policy.name === `${name}_tenant_select`,
        )
      })
      .map(getTableName)
    expect(offenders).toEqual([])
  })

  it('starts every policy of a tenant table with the tenant predicate, for authenticated only', () => {
    for (const table of tenantTables) {
      const name = getTableName(table)
      for (const policy of getTableConfig(table).policies) {
        expect(policy.to, policy.name).toBe(authenticatedRole)
        const expressions = [policy.using, policy.withCheck].filter((e): e is SQL => !!e)
        expect(expressions.length, policy.name).toBeGreaterThan(0)
        for (const expression of expressions) {
          expect(render(expression), policy.name).toMatch(
            new RegExp(`^"${name}"\\."organization_id" = \\(select app\\.org_id\\(\\)\\)`),
          )
        }
      }
    }
  })

  it('lets people read users alone among the better_auth tables and rejects everything else', () => {
    const betterAuthTables = tables.filter(
      (table) => getTableConfig(table).schema === 'better_auth',
    )
    for (const table of betterAuthTables) {
      const name = getTableName(table)
      const policies = getTableConfig(table).policies
      if (name === 'users') {
        expect(policies.map((policy) => policy.name)).toEqual(['users_same_organization_select'])
        continue
      }
      expect(policies, name).toHaveLength(1)
      const [policy] = policies
      expect(
        {
          name: policy?.name,
          as: policy?.as,
          for: policy?.for,
          to: policy?.to,
          using: policy?.using && render(policy.using),
          withCheck: policy?.withCheck && render(policy.withCheck),
        },
        name,
      ).toEqual({
        name: `${name}_no_access`,
        as: 'restrictive',
        for: 'all',
        to: 'public',
        using: 'false',
        withCheck: 'false',
      })
    }
    expect(betterAuthTables).toHaveLength(12)
  })
})
