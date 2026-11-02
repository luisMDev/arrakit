import { randomUUID } from 'node:crypto'

import {
  isWorkEmail,
  normalizeEmail,
  organizationNameOr,
  personNameRefusal,
  slugCandidates,
} from '@arrakit/address'
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'

import { type AuthConfig, isTrustedOrigin } from './config'
import type { AuthDeps } from './auth'
import { termsAccepted } from './organization'
import { allows, customRoleMap, parsePermissions, permissionsOf } from './permissions'

const SIGN_IN_PATHS = new Set(['/sign-in/social', '/sign-in/magic-link'])

const SIGN_IN_FROM_APP = 'Sign in from the app.'
const WORK_EMAIL_REQUIRED = 'Enter a work email, like name@company.com.'
const TERMS_REQUIRED = 'Accept the Terms and the Privacy Policy.'

type Middleware = Parameters<typeof createAuthMiddleware>[0]
type HookContext = Parameters<Middleware>[0]
type Body = Record<string, unknown>
type Data = AuthDeps['data']

/** Sends the invitee a magic link whose callback is the invitation's join page. */
export interface InvitationLinks {
  send?: (email: string, invitationId: string) => Promise<void>
}

interface Invitation {
  id: string
  email: string
  organizationId: string
}

interface MemberRow {
  id: string
  userId: string
  organizationId: string
  role: string
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')
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

/**
 * Names a new organization from its typed name (or the creator) and gives it the first free slug.
 * `termsAccepted`, when sent, must be `true`: `beforeAddMember` then stamps the creator's seat.
 */
async function nameOrganization(ctx: HookContext, body: Body) {
  if (body.termsAccepted !== undefined && body.termsAccepted !== true) {
    throw new APIError('BAD_REQUEST', { message: TERMS_REQUIRED })
  }
  await termsAccepted.set(body.termsAccepted === true)
  const session = await getSessionFromCtx(ctx)
  if (!session) return
  const name = organizationNameOr(text(body.name).trim(), session.user.email, session.user.name)
  return { context: { body: { ...body, name, slug: await freeSlug(ctx, name) } } }
}

const findMember = (ctx: HookContext, where: { field: string; value: string }[]) =>
  ctx.context.adapter.findOne<MemberRow>({ model: 'member', where })

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
  return actor ? { actor, organizationId } : null
}

/**
 * Better Auth checks the permissions a role is given against the actor's, not the ones it
 * already has: changing or deleting a role takes holding all of them.
 */
async function checkRoleChange(ctx: HookContext, data: Data, body: Body) {
  const found = await actorOf(ctx, body)
  if (!found) return
  const rows = await data.forOrganization(found.organizationId).customRoles()
  const roleName = text(body.roleName).toLowerCase()
  const roleId = text(body.roleId)
  const row = rows.find((r) => (roleName ? r.role === roleName : roleId !== '' && r.id === roleId))
  if (
    row &&
    !allows(permissionsOf(found.actor.role, customRoleMap(rows)), parsePermissions(row.permission))
  ) {
    refuse("You can't change a role with permissions you don't have.")
  }
}

function invite(body: Body) {
  const email = normalizeEmail(text(body.email))
  if (!isWorkEmail(email)) {
    throw new APIError('BAD_REQUEST', {
      message: `Enter a work email, like name@organization.com: "${text(body.email)}" is not one.`,
    })
  }
  return { context: { body: { ...body, email } } }
}

/** The person changes only their name (trimmed, one line) and their own settings. */
function updateUser(body: Body) {
  if ('image' in body) {
    throw new APIError('BAD_REQUEST', { message: 'Only your name and settings change here.' })
  }
  if (!('name' in body)) return
  const name = text(body.name).trim()
  const refusal = personNameRefusal(name)
  if (refusal) throw new APIError('BAD_REQUEST', { message: refusal })
  return { context: { body: { ...body, name } } }
}

function signIn(ctx: HookContext, config: AuthConfig) {
  if (ctx.request && !isTrustedOrigin(ctx.headers?.get('origin'), config.trustedOrigins)) {
    refuse(SIGN_IN_FROM_APP)
  }
  if (ctx.path !== '/sign-in/magic-link') return

  const body = (ctx.body ?? {}) as Body
  const email = normalizeEmail(text(body.email))
  if (!isWorkEmail(email)) throw new APIError('BAD_REQUEST', { message: WORK_EMAIL_REQUIRED })
  return { context: { body: { ...body, email } } }
}

export function beforeHook(config: AuthConfig, data: Data) {
  return createAuthMiddleware(async (ctx) => {
    if (SIGN_IN_PATHS.has(ctx.path)) return signIn(ctx, config)
    const body = (ctx.body ?? {}) as Body
    switch (ctx.path) {
      case '/update-user':
        return updateUser(body)
      case '/organization/create':
        return nameOrganization(ctx, body)
      case '/organization/invite-member':
        return invite(body)
      case '/organization/update-role':
      case '/organization/delete-role':
        return checkRoleChange(ctx, data, body)
    }
  })
}

/**
 * The plugin makes a new organization active in the database only; the session cookie is
 * rewritten so its cache names it too.
 */
async function organizationCreated(ctx: HookContext, created: { id: string }) {
  const session = await getSessionFromCtx(ctx)
  if (!session) return
  await setSessionCookie(ctx, {
    session: { ...session.session, activeOrganizationId: created.id },
    user: session.user,
  })
}

/** Mails the invitee a magic link to the join page; a mail that did not go out answers 503. */
async function sendInvitation(deps: AuthDeps, links: InvitationLinks, invitation: Invitation) {
  const { id, email, organizationId } = invitation
  const log = deps.organizations.log
  let sent = true
  try {
    await links.send!(email, id)
  } catch (err) {
    log.error({ err, organizationId, invitationId: id }, 'invite email not sent')
    sent = false
  }
  try {
    await deps.data.forOrganization(organizationId).members.markInvitationEmailSent(id, sent)
  } catch (err) {
    log.error({ err, organizationId, invitationId: id }, 'invite email state not saved')
  }
  if (!sent) {
    throw new APIError('SERVICE_UNAVAILABLE', {
      message: `The invite to ${email} is saved, but its email did not go out. Press Resend to send it again.`,
    })
  }
}

export function afterHook(deps: AuthDeps, links: InvitationLinks) {
  return createAuthMiddleware(async (ctx) => {
    const returned = ctx.context.returned
    if (!returned || isAPIError(returned) || returned instanceof Response) return
    switch (ctx.path) {
      case '/organization/create':
        return organizationCreated(ctx, returned as { id: string })
      case '/organization/leave': {
        const member = returned as MemberRow
        return deps.data.revokeGrants(member.organizationId, member.userId)
      }
      case '/organization/invite-member':
        return sendInvitation(deps, links, returned as Invitation)
    }
  })
}
