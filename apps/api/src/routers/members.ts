import type { MemberView } from '@arrakit/db'

import { member } from '../orpc/base'
import { mapMemberErrors } from '../organizations/member-errors'

const admin = member('admin')

const memberRow = ({ name, email, role }: MemberView) => ({ name, email, role })

export const membersRouter = {
  list: admin.members.list.handler(async ({ context }) =>
    (await context.scope.members.list()).map(memberRow),
  ),
  changeRole: admin.members.changeRole.handler(async ({ context, input }) =>
    memberRow(
      await mapMemberErrors(() =>
        context.scope.members.changeRole(context.user.id, input.email, input.role),
      ),
    ),
  ),
  remove: admin.members.remove.handler(async ({ context, input }) => {
    await mapMemberErrors(() => context.scope.members.remove(context.user.id, input.email))
  }),
}
