import { and, eq, sql } from 'drizzle-orm'

import type { Database } from '../connection'
import type { DataContext } from '../context'
import { toOrganizationId } from '../organization-id'
import {
  oauthAccessTokens,
  oauthConsents,
  oauthRefreshTokens,
  organizations,
} from '../schema/index'

/**
 * Deletes the connector grants (access tokens, refresh tokens, consents) whose reference_id is the
 * organization, only `userId`'s when given. Call inside the transaction that deletes the
 * organization or removes the member. oauth_clients rows always stay.
 */
export async function revokeGrants(
  tx: Database,
  organizationId: string,
  userId?: string,
): Promise<void> {
  const granted = (
    table: typeof oauthAccessTokens | typeof oauthRefreshTokens | typeof oauthConsents,
  ) => {
    const own = eq(table.referenceId, organizationId)
    return userId ? and(own, eq(table.userId, userId)) : own
  }
  await tx.execute(sql`
    with access as (delete from ${oauthAccessTokens} where ${granted(oauthAccessTokens)}),
      refresh as (delete from ${oauthRefreshTokens} where ${granted(oauthRefreshTokens)})
    delete from ${oauthConsents} where ${granted(oauthConsents)}`)
}

export function organizationsData(ctx: DataContext) {
  return {
    /** Revokes grants and deletes the row (cascades every org table). True when a row was deleted. */
    async deleteOrganization(rawId: string): Promise<boolean> {
      const organizationId = toOrganizationId(rawId)
      return ctx.db.transaction(async (tx) => {
        await revokeGrants(tx as unknown as Database, organizationId)
        const removed = await tx
          .delete(organizations)
          .where(eq(organizations.id, organizationId))
          .returning({ id: organizations.id })
        return removed.length > 0
      })
    },
    async organizationBySlug(slug: string): Promise<string | undefined> {
      const [row] = await ctx.db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, slug))
      return row?.id
    },
    /** Every organization id (jobs only). */
    async organizationIds(): Promise<string[]> {
      const rows = await ctx.db.select({ id: organizations.id }).from(organizations)
      return rows.map((row) => row.id)
    },
  }
}
