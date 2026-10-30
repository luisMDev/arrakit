import { type OrganizationRole, isAdminRole } from '@arrakit/address'
import type { Auth } from '@arrakit/auth'
import { DomainError, type OrganizationRow, type OrganizationScope } from '@arrakit/db'
import { ORPCError, os } from '@orpc/server'

import type { AppDeps } from '../deps'
import type { Logger } from '../observability/logger'
import { isUnexpected, reportUnexpected } from '../observability/unexpected-error'

export interface BaseContext {
  deps: AppDeps
  headers: Headers
  /** The app logger bound to this request's id. */
  log: Logger
}

export function procedureContext(deps: AppDeps, headers: Headers, log: Logger): BaseContext {
  return { deps, headers, log }
}

/** oRPC has no default status for PAYMENT_REQUIRED. */
export const PAYMENT_REQUIRED_STATUS = 402

const toORPCError = (thrown: unknown): unknown =>
  thrown instanceof DomainError
    ? new ORPCError(thrown.code, {
        status: thrown.code === 'PAYMENT_REQUIRED' ? PAYMENT_REQUIRED_STATUS : undefined,
        message: thrown.message,
        data: thrown.data,
      })
    : thrown

/**
 * Maps the data layer's domain errors to oRPC errors. oRPC answers a thrown error itself, before
 * Hono's onError, so unexpected ones are logged and reported here, then rethrown for oRPC to
 * answer 500.
 */
export const reportErrors = os
  .$context<BaseContext>()
  .middleware(async ({ context, path, next }) => {
    try {
      return await next()
    } catch (thrown) {
      const error = toORPCError(thrown)
      if (isUnexpected(error)) {
        reportUnexpected(context.log, context.deps.errors, error, { procedure: path.join('.') })
      }
      throw error
    }
  })

export const notInOrganization = () =>
  new ORPCError('NOT_FOUND', { message: 'Not found in your organization.' })

type SessionResult = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>
type SessionUser = SessionResult['user']
export type Session = SessionResult['session']

interface SessionContext extends BaseContext {
  user: SessionUser
  session: Session
}

export type MemberLevel = 'member' | 'admin' | 'owner'
export type { OrganizationRole }

export interface MemberContext extends SessionContext {
  activeOrganization: OrganizationRow
  role: OrganizationRole
  /** forOrganization(activeOrganization.id): the only way to reach this organization's data. */
  scope: OrganizationScope
}

export const requireSession = os.$context<BaseContext>().middleware(async ({ context, next }) => {
  const result = await context.deps.auth.api.getSession({ headers: context.headers })
  if (!result) throw new ORPCError('UNAUTHORIZED')
  return next({ context: { user: result.user, session: result.session } })
})

function roleAllows(role: OrganizationRole, level: MemberLevel): boolean {
  if (level === 'owner') return role === 'owner'
  if (level === 'admin') return isAdminRole(role)
  return true
}

/**
 * Membership read fresh on every call (memberOf). 404 with no organization; 403 below `level`.
 * The organization is always the session person's; ids in the input are ignored.
 */
export function requireMember(level: MemberLevel) {
  return os.$context<SessionContext>().middleware(async ({ context, next }) => {
    const membership = await context.deps.data.memberOf(context.user.id)
    if (!membership) throw notInOrganization()
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
        scope: context.deps.data.forOrganization(membership.organization.id),
      },
    })
  })
}
