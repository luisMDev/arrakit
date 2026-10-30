import { type AccountLanguage, deviceName } from '@arrakit/address'
import type { AccountView } from '@arrakit/contract'
import type { Account } from '@arrakit/db'
import { PLAN_OFFERS } from '@arrakit/plans'
import { ORPCError } from '@orpc/server'

import { authed } from '../orpc/base'
import { grantedTo } from '../orpc/context'

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
    const { data } = context.deps
    // The cached session cookie keeps the name and language it was issued with.
    const [fresh, membership] = await Promise.all([
      context.deps.auth.api.getSession({
        headers: context.headers,
        query: { disableCookieCache: true },
      }),
      data.activeMembership(context.user.id, context.session.id),
    ])
    if (!fresh) throw new ORPCError('UNAUTHORIZED')
    const { user } = fresh
    const organization = membership?.organization ?? null
    return {
      email: user.email,
      name: user.name.trim(),
      language: user.language as AccountLanguage,
      organization,
      role: membership?.role ?? null,
      permissions: membership
        ? await grantedTo(membership.role, data.forOrganization(membership.organization.id))
        : {},
      plan: organization?.plan ?? null,
      seats: organization ? PLAN_OFFERS[organization.plan].seats : null,
    }
  }),
  delete: authed.me.delete.handler(async ({ context }) => {
    await context.deps.data.deleteAccount(context.user.id)
  }),
  account: {
    get: authed.me.account.get.handler(async ({ context }) =>
      accountView(await context.deps.data.account(context.user.id, context.session.id)),
    ),
    update: authed.me.account.update.handler(async ({ context, input }) =>
      accountView(
        await context.deps.data.updateAccount(context.user.id, context.session.id, input),
      ),
    ),
  },
}
