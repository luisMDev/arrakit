import { randomUUID } from 'node:crypto'

import { isWorkEmail, normalizeEmail, organizationNameOr, slugCandidates } from '@arrakit/address'
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api'

import { type AuthConfig, isTrustedOrigin } from './config'
import type { AuthDeps } from './auth'
import {
  type Permissions,
  allows,
  memberChangeRefusal,
  parsePermissions,
  permissionsOf,
} from './permissions'

const SIGN_IN_PATHS = new Set(['/sign-in/social', '/sign-in/magic-link'])

const SIGN_IN_FROM_APP = 'Sign in from the app.'
const WORK_EMAIL_REQUIRED = 'Enter a work email, like name@company.com.'

type Middleware = Parameters<typeof createAuthMiddleware>[0]
type HookContext = Parameters<Middleware>[0]
type Body = Record<string, unknown>

interface MemberRow {
  id: string
  userId: string
  organizationId: string
  role: string
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const roleOf = (value: unknown) =>
  [value]
    .flat()
    .filter((r) => typeof r === 'string')
    .join(',')
const refuse = (message: string): never => {
  throw new APIError('FORBIDDEN', { message })
}

async function freeSlug(ctx: HookContext, name: string): Promise<string> {
  const candidates = slugCandidates(name)
  const taken = await ctx.context.adapter.findMany<{ slug: string }>({
    model: 'organization',
    where: [{ field: 'slug', operator: 'in', value: candidates }],
  })
  const used = new Set(taken.map((row) => row.slug))
  return candidates.find((slug) => !used.has(slug)) ?? `${candidates[0]}-${randomUUID()}`
}

/** Names a new organization from its typed name (or the creator) and gives it the first free slug. */
async function nameOrganization(ctx: HookContext, body: Body) {
  const session = await getSessionFromCtx(ctx)
  if (!session) return
  const name = organizationNameOr(text(body.name).trim(), session.user.email, session.user.name)
  return { context: { body: { ...body, name, slug: await freeSlug(ctx, name) } } }
}

const findMember = (ctx: HookContext, where: { field: string; value: string }[]) =>
  ctx.context.adapter.findOne<MemberRow>({ model: 'member', where })

async function customRoles(ctx: HookContext, organizationId: string) {
  const rows = await ctx.context.adapter.findMany<{ role: string; permission: string }>({
    model: 'organizationRole',
    where: [{ field: 'organizationId', value: organizationId }],
  })
  return Object.fromEntries(
    rows.map((row) => [row.role, parsePermissions(row.permission)]),
  ) as Record<string, Permissions>
}

async function targetOf(ctx: HookContext, body: Body, organizationId: string) {
  if (ctx.path === '/organization/update-member-role') {
    return findMember(ctx, [{ field: 'id', value: text(body.memberId) }])
  }
  const idOrEmail = text(body.memberIdOrEmail)
  if (!idOrEmail.includes('@')) return findMember(ctx, [{ field: 'id', value: idOrEmail }])
  const user = await ctx.context.internalAdapter.findUserByEmail(normalizeEmail(idOrEmail))
  if (!user) return null
  return findMember(ctx, [
    { field: 'organizationId', value: organizationId },
    { field: 'userId', value: user.user.id },
  ])
}

/** The signed-in person's membership in the organization the body names (or the active one). */
async function actorOf(ctx: HookContext, body: Body) {
  const session = await getSessionFromCtx(ctx)
  if (!session) return null
  const organizationId = text(body.organizationId) || session.session.activeOrganizationId
  if (typeof organizationId !== 'string' || !organizationId) return null
  const actor = await findMember(ctx, [
    { field: 'organizationId', value: organizationId },
    { field: 'userId', value: session.user.id },
  ])
  return actor ? { actor, organizationId, userId: session.user.id } : null
}

/** Refuses the member changes Better Auth would allow but the organization's rules do not. */
async function checkMemberChange(ctx: HookContext, body: Body) {
  const found = await actorOf(ctx, body)
  if (!found) return
  const { actor, organizationId, userId } = found

  const invites = ctx.path === '/organization/invite-member'
  const target = invites ? null : await targetOf(ctx, body, organizationId)
  if (!invites && target?.organizationId !== organizationId) return
  const refusal = memberChangeRefusal({
    actorRole: actor.role,
    targetRole: target?.role,
    newRole: ctx.path === '/organization/remove-member' ? undefined : roleOf(body.role),
    self: target?.userId === userId,
    custom: await customRoles(ctx, organizationId),
  })
  if (refusal) refuse(refusal)
}

/**
 * Better Auth checks the permissions a role is given against the actor's, not the ones it
 * already has: changing or deleting a role takes holding all of them.
 */
async function checkRoleChange(ctx: HookContext, body: Body) {
  const found = await actorOf(ctx, body)
  if (!found) return
  const custom = await customRoles(ctx, found.organizationId)
  const roleName = text(body.roleName).toLowerCase()
  const roleId = text(body.roleId)
  const role = roleName
    ? custom[roleName]
    : roleId
      ? await ctx.context.adapter
          .findOne<{ permission: string }>({
            model: 'organizationRole',
            where: [
              { field: 'organizationId', value: found.organizationId },
              { field: 'id', value: roleId },
            ],
          })
          .then((row) => (row ? parsePermissions(row.permission) : undefined))
      : undefined
  if (role && !allows(permissionsOf(found.actor.role, custom), role)) {
    refuse("You can't change a role with permissions you don't have.")
  }
}

async function invite(ctx: HookContext, body: Body) {
  const email = normalizeEmail(text(body.email))
  if (!isWorkEmail(email)) {
    throw new APIError('BAD_REQUEST', {
      message: `Enter a work email, like name@organization.com: "${text(body.email)}" is not one.`,
    })
  }
  await checkMemberChange(ctx, body)
  return { context: { body: { ...body, email } } }
}

function signIn(ctx: HookContext, config: AuthConfig) {
  if (!isTrustedOrigin(ctx.headers?.get('origin'), config.trustedOrigins)) {
    refuse(SIGN_IN_FROM_APP)
  }
  if (ctx.path !== '/sign-in/magic-link') return

  const body = (ctx.body ?? {}) as Body
  const email = normalizeEmail(text(body.email))
  if (!isWorkEmail(email)) throw new APIError('BAD_REQUEST', { message: WORK_EMAIL_REQUIRED })
  return { context: { body: { ...body, email } } }
}

export function beforeHook(config: AuthConfig) {
  return createAuthMiddleware(async (ctx) => {
    if (SIGN_IN_PATHS.has(ctx.path)) return signIn(ctx, config)
    const body = (ctx.body ?? {}) as Body
    switch (ctx.path) {
      case '/organization/create':
        return nameOrganization(ctx, body)
      case '/organization/invite-member':
        return invite(ctx, body)
      case '/organization/update-member-role':
      case '/organization/remove-member':
        return checkMemberChange(ctx, body)
      case '/organization/update-role':
      case '/organization/delete-role':
        return checkRoleChange(ctx, body)
    }
  })
}

/**
 * The plugin swallows a failed invite email (it runs the sender as a background task), so the
 * sender records the failure and the invite answers 503 here, with the invitation kept.
 */
export function afterHook(data: AuthDeps['data'], unsentInvitations: Set<string>) {
  return createAuthMiddleware(async (ctx) => {
    const returned = ctx.context.returned
    if (!returned || isAPIError(returned) || returned instanceof Response) return
    if (ctx.path === '/organization/leave') {
      const member = returned as MemberRow
      await data.revokeGrants(member.organizationId, member.userId)
    }
    if (ctx.path === '/organization/invite-member') {
      const invitation = returned as { id: string; email: string }
      if (!unsentInvitations.delete(invitation.id)) return
      throw new APIError('SERVICE_UNAVAILABLE', {
        message: `The invite to ${invitation.email} is saved, but its email did not go out. Press Resend to send it again.`,
      })
    }
  })
}
