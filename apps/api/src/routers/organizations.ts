import { member, notImplemented } from '../orpc/base'

export const organizationsRouter = {
  update: member('admin').organizations.update.handler(() =>
    notImplemented('organizations.update'),
  ),
  delete: member('owner').organizations.delete.handler(() =>
    notImplemented('organizations.delete'),
  ),
}
