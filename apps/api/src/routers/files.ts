import type { Plan } from '@arrakit/plans'

import { fileService } from '../files/files'
import { member } from '../orpc/base'
import type { MemberContext } from '../orpc/context'

const filesOf = (context: MemberContext) =>
  fileService({
    userId: context.user.id,
    permissions: context.permissions,
    plan: context.activeOrganization.plan as Plan,
    scope: context.scope,
    log: context.log,
  })

export const filesRouter = {
  policy: member({ file: ['read'] }).files.policy.handler(({ context }) =>
    filesOf(context).policy(),
  ),
  list: member({ file: ['read'] }).files.list.handler(({ context, input }) =>
    filesOf(context).list(input.workspaceId ?? null),
  ),
  requestUpload: member({ file: ['upload'] }).files.requestUpload.handler(
    ({ context, input: { workspaceId, ...file } }) =>
      filesOf(context).requestUpload({ ...file, workspaceId: workspaceId ?? null }),
  ),
  completeUpload: member({ file: ['upload'] }).files.completeUpload.handler(({ context, input }) =>
    filesOf(context).completeUpload(input.id),
  ),
  downloadUrl: member({ file: ['read'] }).files.downloadUrl.handler(({ context, input }) =>
    filesOf(context).downloadUrl(input.id),
  ),
  rename: member({ file: ['read'] }).files.rename.handler(({ context, input }) =>
    filesOf(context).rename(input.id, input.name),
  ),
  delete: member({ file: ['read'] }).files.delete.handler(({ context, input }) =>
    filesOf(context).remove(input.id),
  ),
}
