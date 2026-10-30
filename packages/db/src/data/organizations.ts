import { and, eq, sql } from 'drizzle-orm'

import { type Database, transaction } from '../connection'
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
      return transaction(ctx.db, async (tx) => {
        await revokeGrants(tx, organizationId)
        const removed = await tx
          .delete(organizations)
          .where(eq(organizations.id, organizationId))
          .returning({ id: organizations.id })
        return removed.length > 0
      })
    },
  }
}
