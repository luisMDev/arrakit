import { member } from '../orpc/base'
import type { MemberContext } from '../orpc/context'
import { taskService } from '../tasks/tasks'

const tasksOf = (context: MemberContext) =>
  taskService({
    userId: context.user.id,
    permissions: context.permissions,
    scope: context.scope,
  })

export const tasksRouter = {
  list: member().tasks.list.handler(({ context, input }) => tasksOf(context).list(input)),
  get: member().tasks.get.handler(({ context, input }) => tasksOf(context).get(input.id)),
}
