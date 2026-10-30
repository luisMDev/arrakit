import { and, asc, eq } from 'drizzle-orm'

import type { DataContext } from '../context'
import type { OrganizationId } from '../organization-id'
import { teamMembers, teams, users } from '../schema/index'

export interface TeamMemberView {
  userId: string
  name: string
  email: string
  image: string | null
}

export function teamsScope(ctx: DataContext, organizationId: OrganizationId) {
  return {
    /** The people on one of the organization's teams, oldest first; empty for another's team. */
    teamMembers: (teamId: string): Promise<TeamMemberView[]> =>
      ctx.db
        .select({ userId: users.id, name: users.name, email: users.email, image: users.image })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.teamId))
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(and(eq(teamMembers.teamId, teamId), eq(teams.organizationId, organizationId)))
        .orderBy(asc(teamMembers.createdAt), asc(teamMembers.id)),
  }
}
