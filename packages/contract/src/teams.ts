import { z } from 'zod'

import { base } from './common'

export const teamMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
})
export type TeamMember = z.infer<typeof teamMemberSchema>

/** Better Auth lists a team's members only to its own members; this lists them to anyone in the organization. */
export const teamsContract = {
  members: base.input(z.object({ teamId: z.string() })).output(z.array(teamMemberSchema)),
}
