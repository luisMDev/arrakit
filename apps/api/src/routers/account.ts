import { PLAN_OFFERS } from '@arrakit/plans'

import { authed, notImplemented } from '../orpc/base'

export const meRouter = {
  get: authed.me.get.handler(async ({ context }) => {
    const membership = await context.data.memberOf(context.user.id)
    const organization = membership?.organization ?? null
    return {
      email: context.user.email,
      name: context.user.name.trim() ? context.user.name.trim() : '',
      language: context.user.language === 'es' ? 'es' : 'en',
      organization: organization && {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        plan: organization.plan,
      },
      role: membership?.role ?? null,
      plan: organization?.plan ?? null,
      seats: organization ? PLAN_OFFERS[organization.plan].seats : null,
    }
  }),
  delete: authed.me.delete.handler(() => notImplemented('me.delete')),
  account: {
    get: authed.me.account.get.handler(() => notImplemented('me.account.get')),
    update: authed.me.account.update.handler(() => notImplemented('me.account.update')),
  },
}
