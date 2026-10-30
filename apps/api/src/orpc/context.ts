import type { Auth } from '@arrakit/auth'
import { isTrustedOrigin } from '@arrakit/auth'
import type { OrganizationRow, OrganizationScope, ScopedData } from '@arrakit/db'
import { ORPCError, os } from '@orpc/server'

import type { AppDeps } from '../deps'

/** What every procedure receives (built per request in app.ts). */
export interface BaseContext {
  deps: AppDeps
  data: ScopedData
  headers: Headers
}

type SessionResult = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>
export type SessionUser = SessionResult['user']
export type Session = SessionResult['session']

export interface SessionContext extends BaseContext {
  user: SessionUser
  session: Session
}

export type MemberLevel = 'member' | 'admin' | 'owner'
export type OrganizationRole = 'owner' | 'admin' | 'member'

export interface MemberContext extends SessionContext {
  activeOrganization: OrganizationRow
  role: OrganizationRole
  /** forOrganization(activeOrganization.id): the only way to reach this organization's data. */
  scope: OrganizationScope
}

/** 401 without a live Better Auth session; puts `{ user, session }` in the context. */
export const requireSession = os.$context<BaseContext>().middleware(async ({ context, next }) => {
  const result = await context.deps.auth.api.getSession({ headers: context.headers })
  if (!result) throw new ORPCError('UNAUTHORIZED')
  return next({ context: { user: result.user, session: result.session } })
})

/** Does `role` reach `level`? */
export function roleAllows(role: OrganizationRole, level: MemberLevel): boolean {
  if (level === 'owner') return role === 'owner'
  if (level === 'admin') return role === 'owner' || role === 'admin'
  return true
}

/**
 * Membership read fresh on every call (memberOf). 404 with no organization; 403 below `level`.
 * The organization is always the session person's; ids in the input are ignored.
 */
export function requireMember(level: MemberLevel) {
  return os.$context<SessionContext>().middleware(async ({ context, next }) => {
    const membership = await context.data.memberOf(context.user.id)
    if (!membership)
      throw new ORPCError('NOT_FOUND', { message: 'Not found in your organization.' })
    if (!roleAllows(membership.role, level)) {
      throw new ORPCError('FORBIDDEN', {
        message:
          level === 'owner'
            ? "Only the organization's owner can do this."
            : 'Only an admin of the organization can do this.',
      })
    }
    return next({
      context: {
        activeOrganization: membership.organization,
        role: membership.role,
        scope: context.data.forOrganization(membership.organization.id),
      },
    })
  })
}

/** 403 `message` unless the request's Origin is exactly one of the trusted origins (CSRF guard). */
export function requireTrustedOrigin(message: string) {
  return os.$context<BaseContext>().middleware(async ({ context, next }) => {
    if (!isTrustedOrigin(context.headers.get('origin'), context.deps.authConfig.trustedOrigins)) {
      throw new ORPCError('FORBIDDEN', { message })
    }
    return next()
  })
}

/** 503 when Stripe is not configured; puts the gateway in the context. */
export const requireStripe = os.$context<BaseContext>().middleware(async ({ context, next }) => {
  const stripe = context.deps.stripe
  if (!stripe)
    throw new ORPCError('SERVICE_UNAVAILABLE', { message: 'Payments are not set up yet.' })
  return next({ context: { stripe } })
})
