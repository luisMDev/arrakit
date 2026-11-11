import { artifactService } from '../artifacts/artifacts'
import { member } from '../orpc/base'
import type { MemberContext } from '../orpc/context'

const artifactsOf = (context: MemberContext) =>
  artifactService({
    userId: context.user.id,
    permissions: context.permissions,
    plan: context.activeOrganization.plan,
    scope: context.scope,
  })

export const artifactsRouter = {
  list: member({ artifact: ['read'] }).artifacts.list.handler(({ context, input }) =>
    artifactsOf(context).list(input.workspaceId ?? null),
  ),
  get: member({ artifact: ['read'] }).artifacts.get.handler(({ context, input }) =>
    artifactsOf(context).get(input.id),
  ),
  versions: member({ artifact: ['read'] }).artifacts.versions.handler(({ context, input }) =>
    artifactsOf(context).versions(input.id),
  ),
  content: member({ artifact: ['read'] }).artifacts.content.handler(({ context, input }) =>
    artifactsOf(context).content(input.id, input.version),
  ),
  create: member({ artifact: ['create'] }).artifacts.create.handler(
    ({ context, input: { workspaceId, ...artifact } }) =>
      artifactsOf(context).create({ ...artifact, workspaceId: workspaceId ?? null }),
  ),
  publish: member({ artifact: ['read'] }).artifacts.publish.handler(({ context, input }) =>
    artifactsOf(context).publish(input.id, input.content),
  ),
  rename: member({ artifact: ['read'] }).artifacts.rename.handler(({ context, input }) =>
    artifactsOf(context).rename(input.id, input.title),
  ),
  delete: member({ artifact: ['read'] }).artifacts.delete.handler(({ context, input }) =>
    artifactsOf(context).remove(input.id),
  ),
}
