import { and, eq, sql } from 'drizzle-orm'

import type { DataContext } from '../context'
import { toOrganizationId } from '../organization-id'
import { oauthAccessTokens, oauthConsents, oauthRefreshTokens } from '../schema/index'

export function organizationsData(ctx: DataContext) {
  return {
    /**
     * Deletes the connector grants (access tokens, refresh tokens, consents) whose reference_id is
     * the organization, only `userId`'s when given. oauth_clients rows always stay.
     */
    async revokeGrants(rawOrganizationId: string, userId?: string): Promise<void> {
      const organizationId = toOrganizationId(rawOrganizationId)
      const granted = (
        table: typeof oauthAccessTokens | typeof oauthRefreshTokens | typeof oauthConsents,
      ) => {
        const own = eq(table.referenceId, organizationId)
        return userId ? and(own, eq(table.userId, userId)) : own
      }
      await ctx.db.execute(sql`
        with access as (delete from ${oauthAccessTokens} where ${granted(oauthAccessTokens)}),
          refresh as (delete from ${oauthRefreshTokens} where ${granted(oauthRefreshTokens)})
        delete from ${oauthConsents} where ${granted(oauthConsents)}`)
    },
  }
}
