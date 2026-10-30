import { and, eq } from 'drizzle-orm'

import type { Database } from '../connection'
import type { DataContext } from '../context'
import { NotImplementedError } from '../errors'
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
  for (const table of [oauthAccessTokens, oauthRefreshTokens, oauthConsents]) {
    const own = eq(table.referenceId, organizationId)
    await tx.delete(table).where(userId ? and(own, eq(table.userId, userId)) : own)
  }
}

export function organizationsData(ctx: DataContext) {
  return {
    /** Revokes grants and deletes the row (cascades every org table). True when a row was deleted. */
    async deleteOrganization(_id: string): Promise<boolean> {
      throw new NotImplementedError('deleteOrganization')
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
