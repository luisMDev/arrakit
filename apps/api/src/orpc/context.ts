import type { Auth } from '@arrakit/auth'
import {
  type Permissions,
  allows,
  claimsFor,
  customRoleMap,
  isStaticRole,
  permissionsOf,
  rolesOf,
} from '@arrakit/auth/permissions'
import {
  DomainError,
  type OrganizationRow,
  type OrganizationScope,
  type ScopedData,
} from '@arrakit/db'
import { ORPCError, os } from '@orpc/server'
import { isAPIError } from 'better-auth/api'

import type { AppDeps } from '../deps'
import type { Logger } from '../observability/logger'
import { isUnexpected, reportUnexpected } from '../observability/error-reporter'

export interface BaseContext {
  deps: AppDeps
  headers: Headers
  /** The app logger bound to this request's id. */
  log: Logger
}

/** oRPC has no default status for PAYMENT_REQUIRED. */
export const PAYMENT_REQUIRED_STATUS = 402

const toORPCError = (thrown: unknown): unknown => {
  if (thrown instanceof DomainError) {
    return new ORPCError(thrown.code, {
      status: thrown.code === 'PAYMENT_REQUIRED' ? PAYMENT_REQUIRED_STATUS : undefined,
      message: thrown.message,
      data: thrown.data,
    })
  }
  if (isAPIError(thrown) && thrown.statusCode < 500) {
    return new ORPCError(String(thrown.status), {
      status: thrown.statusCode,
      message: thrown.body?.message ?? thrown.message,
    })
  }
  return thrown
}

/**
 * Maps the data layer's domain errors and Better Auth's refusals to oRPC errors. oRPC answers a thrown error itself, before
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

type SessionResult = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>
type SessionUser = SessionResult['user']
type Session = SessionResult['session']

interface SessionContext extends BaseContext {
  user: SessionUser
  session: Session
}

export interface MemberContext extends SessionContext {
  activeOrganization: OrganizationRow
  /** Better Auth's role string (`owner`, `admin`, `member`, custom roles, joined by `,`). */
  role: string
  permissions: Permissions
  /**
   * The member's own scope, under RLS with the claims of `permissions`: the only way to reach
   * this organization's data.
   */
  scope: OrganizationScope
}

const sessionCheck = (live: boolean) =>
  os.$context<BaseContext>().middleware(async ({ context, next }) => {
    const result = await context.deps.auth.api.getSession({
      headers: context.headers,
      ...(live ? { query: { disableCookieCache: true } } : {}),
    })
    if (!result) throw new ORPCError('UNAUTHORIZED')
    return next({ context: { user: result.user, session: result.session } })
  })

/** The session from its cached cookie (up to five minutes old). */
export const requireSession = sessionCheck(false)

/** The session read from the database: one ended on another device is refused at once. */
export const requireLiveSession = sessionCheck(true)

export const NOT_PERMITTED = "You don't have permission to do this."

/** What `role` grants in the organization, reading its custom roles only when it has one. */
export async function grantedTo(
  role: string,
  data: Pick<ScopedData, 'customRoles'>,
  organizationId: string,
): Promise<Permissions> {
  if (rolesOf(role).every(isStaticRole)) return permissionsOf(role)
  return permissionsOf(role, customRoleMap(await data.customRoles(organizationId)))
}

/**
 * Membership in the session's active organization, read fresh on every call (the earliest
 * organization when none is active or it is no longer theirs). 404 with no organization; 403
 * when the role lacks `wanted`. Organization ids in the input are ignored.
 */
export function requireMember(wanted: Permissions = {}) {
  return os.$context<SessionContext>().middleware(async ({ context, next }) => {
    const { data } = context.deps
    const membership = await data.activeMembership(context.user.id, context.session.id)
    if (!membership)
      throw new ORPCError('NOT_FOUND', { message: 'Not found in your organization.' })
    const organizationId = membership.organization.id
    const permissions = await grantedTo(membership.role, data, organizationId)
    if (!allows(permissions, wanted)) {
      throw new ORPCError('FORBIDDEN', { message: NOT_PERMITTED })
    }
    const scope = data.forOrganization(
      claimsFor({ userId: context.user.id, organizationId, permissions }),
    )
    return next({
      context: {
        activeOrganization: membership.organization,
        role: membership.role,
        permissions,
        scope,
      },
    })
  })
}
