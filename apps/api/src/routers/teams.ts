import { member } from '../orpc/base'

export const teamsRouter = {
  members: member().teams.members.handler(({ context, input }) =>
    context.scope.teamMembers(input.teamId),
  ),
}
