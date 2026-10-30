import { deviceName } from '@arrakit/address'
import type { AccountView } from '@arrakit/contract'
import type { Account } from '@arrakit/db'
import { PLAN_OFFERS } from '@arrakit/plans'
import { ORPCError } from '@orpc/server'

import { authed } from '../orpc/base'
import { organizationSummary } from '../organizations/organization-summary'

function accountView(account: Account | null): AccountView {
  if (!account) throw new ORPCError('UNAUTHORIZED')
  return {
    name: account.user.name,
    email: account.user.email,
    signInWith: account.signInWith,
    devices: account.sessions.map((session) => deviceName(session.userAgent)),
    language: account.user.language,
    timeZone: account.user.timeZone,
    emails: account.user.emails,
  }
}

export const meRouter = {
  get: authed.me.get.handler(async ({ context }) => {
    const membership = await context.data.memberOf(context.user.id)
    const organization = membership?.organization ?? null
    return {
      email: context.user.email,
      name: context.user.name.trim(),
      language: context.user.language === 'es' ? 'es' : 'en',
      organization: organization && organizationSummary(organization),
      role: membership?.role ?? null,
      plan: organization?.plan ?? null,
      seats: organization ? PLAN_OFFERS[organization.plan].seats : null,
    }
  }),
  delete: authed.me.delete.handler(async ({ context }) => {
    await context.data.deleteAccount(context.user.id)
  }),
  account: {
    get: authed.me.account.get.handler(async ({ context }) =>
      accountView(await context.data.account(context.user.id, context.session.id)),
    ),
    update: authed.me.account.update.handler(async ({ context, input }) =>
      accountView(await context.data.updateAccount(context.user.id, context.session.id, input)),
    ),
  },
}
