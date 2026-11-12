import { getTableColumns, getTableName, isTable } from 'drizzle-orm'
import { type PgTable, getTableConfig } from 'drizzle-orm/pg-core'
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
