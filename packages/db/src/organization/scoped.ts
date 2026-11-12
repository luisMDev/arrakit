import { sql } from 'drizzle-orm'

import { type Database, transaction } from '../connection'

/** What RLS reads through `auth.jwt()`: the same shape the browser token carries. */
export interface Claims {
  sub?: string
  role: 'authenticated'
  org_id: string
  permissions: readonly string[]
  actor: 'user' | 'system'
}

/** A person acting inside one organization, as `claimsFor` in `@arrakit/auth/permissions` builds them. */
export interface MemberClaims extends Claims {
  sub: string
  actor: 'user'
}

/** Server work acting inside one organization; only the data layer builds it. */
export const systemClaims = (organizationId: string): Claims => ({
  role: 'authenticated',
  org_id: organizationId,
  permissions: [],
  actor: 'system',
})

export type Scoped = <R>(work: (tx: Database) => Promise<R>) => Promise<R>

/**
 * Runs each piece of work in its own transaction under the `authenticated` role with `claims`, so
 * RLS applies to every statement of it. Both settings are local to the transaction; a nested
 * `transaction(tx, ...)` is a savepoint and keeps them.
 */
export function scopedTo(db: Database, claims: Claims): Scoped {
  const serialized = JSON.stringify(claims)
  return (work) =>
    transaction(db, async (tx) => {
      await tx.execute(
        sql`select set_config('request.jwt.claims', ${serialized}, true), set_config('role', 'authenticated', true)`,
      )
      return work(tx)
    })
}
