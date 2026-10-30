import { member, notImplemented } from '../orpc/base'

const admin = member('admin')

export const membersRouter = {
  list: admin.members.list.handler(() => notImplemented('members.list')),
  changeRole: admin.members.changeRole.handler(() => notImplemented('members.changeRole')),
  remove: admin.members.remove.handler(() => notImplemented('members.remove')),
}
