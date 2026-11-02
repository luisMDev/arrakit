import { deviceName } from '@arrakit/address'
import type { AccountView } from '@arrakit/contract'
import type { Account } from '@arrakit/db'
import { PLAN_OFFERS } from '@arrakit/plans'
import { ORPCError } from '@orpc/server'

import { authed, authedLive } from '../orpc/base'
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
  get: authedLive.me.get.handler(async ({ context }) => {
    const { data } = context.deps
    const { user } = context
    const active = context.session.activeOrganizationId
    const membership =
      (active ? await data.membershipIn(user.id, active) : null) ?? (await data.memberOf(user.id))
    const organization = membership?.organization ?? null
    return {
      email: user.email,
      name: user.name.trim(),
      language: user.language,
      organization,
      role: membership?.role ?? null,
      permissions: membership
        ? await grantedTo(membership.role, data.forOrganization(membership.organization.id))
        : {},
      plan: organization?.plan ?? null,
      seats: organization ? PLAN_OFFERS[organization.plan].seats : null,
    }
  }),
  account: {
    get: authed.me.account.get.handler(async ({ context }) =>
      accountView(await context.deps.data.account(context.user.id, context.session.id)),
    ),
  },
}
