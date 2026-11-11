import { member } from '../orpc/base'
import type { MemberContext } from '../orpc/context'
import { taskService } from '../tasks/tasks'

const tasksOf = (context: MemberContext) =>
  taskService({
    userId: context.user.id,
    permissions: context.permissions,
    scope: context.scope,
    organizationId: context.activeOrganization.id,
  })

export const tasksRouter = {
  list: member().tasks.list.handler(({ context, input }) => tasksOf(context).list(input)),
  get: member().tasks.get.handler(({ context, input }) => tasksOf(context).get(input.id)),
  watch: member().tasks.watch.handler(({ context, input, signal }) =>
    tasksOf(context).watch(input, context.deps.taskWatches, signal),
  ),
}
