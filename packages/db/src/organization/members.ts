import { isWorkEmail, normalizeEmail } from '@arrakit/address'
import { PLAN_LABELS, PLAN_OFFERS, type Plan } from '@arrakit/plans'
import { type SQL, and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm'

import type { Database } from '../connection'
import type { DataContext } from '../context'
import {
  AlreadyMemberError,
  InviteEmailUnusableError,
  MemberChangeRefusedError,
  NoSuchMemberError,
  SeatLimitError,
} from '../errors'
import type { OrganizationId } from '../organization-id'
import { invitations, members, organizations, users } from '../schema/index'
import { revokeGrants } from '../data/organizations'

export type OrganizationRole = 'owner' | 'admin' | 'member'
export type AssignableRole = 'admin' | 'member'

export const INVITE_DAYS = 7
export const INVITE_MS = INVITE_DAYS * 24 * 60 * 60 * 1000

export interface MemberView {
  userId: string
  name: string
  email: string
  image: string | null
  role: OrganizationRole
  joinedAt: Date
}

export interface PendingInvitation {
  id: string
  email: string
  role: AssignableRole
  sentAt: Date
  expiresAt: Date
  emailSent: boolean
}

export interface OrganizationMembers {
  list(): Promise<MemberView[]>
  /** Live invitations (pending and unexpired), oldest first. */
  invitations(): Promise<PendingInvitation[]>
  invite(input: {
    email: string
    role: AssignableRole
    inviterId: string
  }): Promise<PendingInvitation>
  resend(id: string): Promise<PendingInvitation | undefined>
  markEmailSent(id: string): Promise<PendingInvitation | undefined>
  cancel(id: string): Promise<boolean>
  changeRole(actorUserId: string, email: string, role: AssignableRole): Promise<MemberView>
  remove(actorUserId: string, email: string): Promise<void>
}

const ROLES: readonly string[] = ['owner', 'admin', 'member']

export const toOrganizationRole = (role: string): OrganizationRole =>
  ROLES.includes(role) ? (role as OrganizationRole) : 'member'

export const toAssignableRole = (role: string | null): AssignableRole =>
  role === 'admin' ? 'admin' : 'member'

const isAdminRole = (role: string) => role === 'owner' || role === 'admin'

export interface PolicyMember {
  userId: string
  organizationId: string
  role: string
}

export type MemberChange =
  | { kind: 'invite'; organizationId: string; role: string }
  | { kind: 'role'; target: PolicyMember; role: string }
  | { kind: 'remove'; target: PolicyMember }

export interface MemberChangeInput {
  actor: PolicyMember
  change: MemberChange
  /** Current owner rows and admin rows (owners not counted among admins). */
  owners: number
  admins: number
}

export type MemberChangeVerdict = { ok: true } | { ok: false; reason: string }

const ALLOWED: MemberChangeVerdict = { ok: true }
const refuse = (reason: string): MemberChangeVerdict => ({ ok: false, reason })

/** Whether `actor` may make `change`. Pure: callers read the rows under a lock. */
export function checkMemberChange({
  actor,
  change,
  owners,
  admins,
}: MemberChangeInput): MemberChangeVerdict {
  const organizationId =
    change.kind === 'invite' ? change.organizationId : change.target.organizationId
  if (actor.organizationId !== organizationId)
    return refuse('That person is not in your organization.')
  if (!isAdminRole(actor.role)) return refuse('Only an admin manages members.')
  const isOwner = actor.role === 'owner'

  if (change.kind !== 'remove') {
    if (change.role === 'owner')
      return refuse('No one is made owner: the organization has its creator.')
    if (change.role !== 'admin' && change.role !== 'member')
      return refuse(`There is no role "${change.role}".`)
  }
  if (change.kind === 'invite') return ALLOWED

  const { target } = change
  const self = target.userId === actor.userId
  const newRole = change.kind === 'role' ? change.role : null
  if (target.role === 'owner') {
    if (!self) return refuse("Only the owner changes the owner's role or seat.")
    return owners > 1 ? ALLOWED : refuse("You are the organization's only owner.")
  }
  if (target.role === 'admin') {
    if (newRole === 'admin') return ALLOWED
    if (!self && !isOwner) return refuse('Only the owner demotes or removes an admin.')
    if (self && owners + admins - 1 < 1) return refuse("You are the organization's last admin.")
    return ALLOWED
  }
  if (newRole === 'admin' && !isOwner) return refuse('Only the owner names admins.')
  return ALLOWED
}

export function requireMemberChange(input: MemberChangeInput): void {
  const verdict = checkMemberChange(input)
  if (!verdict.ok) throw new MemberChangeRefusedError(verdict.reason)
}

export function seatLimitError(plan: Plan): SeatLimitError {
  const seats = PLAN_OFFERS[plan].seats
  return new SeatLimitError(
    `Your organization's ${PLAN_LABELS[plan]} plan includes ${seats} ${seats === 1 ? 'seat' : 'seats'}, all taken. Upgrade to invite more people.`,
  )
}

type InvitationRow = typeof invitations.$inferSelect

export const toPending = (row: InvitationRow): PendingInvitation => ({
  id: row.id,
  email: row.email,
  role: toAssignableRole(row.role),
  sentAt: new Date(row.expiresAt.getTime() - INVITE_MS),
  expiresAt: row.expiresAt,
  emailSent: row.emailSent,
})

export const liveInvitation = () =>
  and(eq(invitations.status, 'pending'), gt(invitations.expiresAt, sql`now()`))

const inviteExpiry = () => sql`now() + make_interval(days => ${INVITE_DAYS})`

/** The organization's plan, its row held until the transaction ends so seat checks never interleave. */
export async function lockedPlan(tx: Database, organizationId: string): Promise<Plan | undefined> {
  const [row] = await tx
    .select({ plan: organizations.plan })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .for('no key update')
  return row?.plan
}

export async function memberCount(tx: Database, organizationId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(members)
    .where(eq(members.organizationId, organizationId))
  return row?.n ?? 0
}

/** Members plus live invitations other than `holding`'s fill the plan: SeatLimitError. */
async function requireSeat(tx: Database, organizationId: string, plan: Plan, holding: string) {
  const [held] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        liveInvitation(),
        ne(invitations.email, holding),
      ),
    )
  if ((await memberCount(tx, organizationId)) + (held?.n ?? 0) >= PLAN_OFFERS[plan].seats) {
    throw seatLimitError(plan)
  }
}

const memberColumns = {
  id: members.id,
  userId: members.userId,
  name: users.name,
  email: users.email,
  image: users.image,
  role: members.role,
  joinedAt: members.createdAt,
}

type MemberRow = {
  userId: string
  name: string
  email: string
  image: string | null
  role: string
  joinedAt: Date
}

const toMember = (row: MemberRow): MemberView => ({
  userId: row.userId,
  name: row.name,
  email: row.email,
  image: row.image,
  role: toOrganizationRole(row.role),
  joinedAt: row.joinedAt,
})

export function membersScope(
  ctx: DataContext,
  organizationId: OrganizationId,
): OrganizationMembers {
  const { db } = ctx
  const inOrganization = eq(members.organizationId, organizationId)
  const pendingHere = (where: SQL) =>
    and(eq(invitations.organizationId, organizationId), eq(invitations.status, 'pending'), where)

  const transaction = <R>(work: (tx: Database) => Promise<R>) =>
    db.transaction((tx) => work(tx as unknown as Database))

  async function actorIn(tx: Database, userId: string): Promise<PolicyMember> {
    const [row] = await tx
      .select({ role: members.role })
      .from(members)
      .where(and(inOrganization, eq(members.userId, userId)))
      .for('share')
    return { userId, organizationId: row ? organizationId : '', role: row?.role ?? '' }
  }

  // Owner and admin rows locked in id order (deadlock-free): two last admins stepping down at
  // once cannot both pass.
  const lockAdmins = (tx: Database) =>
    tx
      .select({ userId: members.userId, role: members.role })
      .from(members)
      .where(and(inOrganization, inArray(members.role, ['owner', 'admin'])))
      .orderBy(asc(members.id))
      .for('update')

  async function checked(
    tx: Database,
    actorUserId: string,
    email: string,
    change: (target: PolicyMember) => MemberChange,
  ) {
    const locked = await lockAdmins(tx)
    const normalized = normalizeEmail(email)
    const [target] = await tx
      .select(memberColumns)
      .from(members)
      .innerJoin(users, eq(members.userId, users.id))
      .where(and(inOrganization, eq(users.email, normalized)))
      .for('update', { of: members })
    if (!target) throw new NoSuchMemberError(normalized)
    requireMemberChange({
      actor: {
        userId: actorUserId,
        organizationId,
        role: locked.find((row) => row.userId === actorUserId)?.role ?? '',
      },
      change: change({ userId: target.userId, organizationId, role: target.role }),
      owners: locked.filter((row) => row.role === 'owner').length,
      admins: locked.filter((row) => row.role === 'admin').length,
    })
    return target
  }

  return {
    async list() {
      const rows = await db
        .select(memberColumns)
        .from(members)
        .innerJoin(users, eq(members.userId, users.id))
        .where(inOrganization)
        .orderBy(asc(members.createdAt), asc(members.id))
      return rows.map(toMember)
    },

    async invitations() {
      const rows = await db
        .select()
        .from(invitations)
        .where(and(eq(invitations.organizationId, organizationId), liveInvitation()))
        .orderBy(asc(invitations.createdAt), asc(invitations.id))
      return rows.map(toPending)
    },

    async invite({ email, role, inviterId }) {
      const normalized = normalizeEmail(email)
      if (!isWorkEmail(normalized)) throw new InviteEmailUnusableError(email)
      return transaction(async (tx) => {
        const plan = await lockedPlan(tx, organizationId)
        requireMemberChange({
          actor: await actorIn(tx, inviterId),
          change: { kind: 'invite', organizationId, role },
          owners: 0,
          admins: 0,
        })
        const [already] = await tx
          .select({ id: members.id })
          .from(members)
          .innerJoin(users, eq(members.userId, users.id))
          .where(and(inOrganization, eq(users.email, normalized)))
        if (already) throw new AlreadyMemberError(normalized)
        if (plan) await requireSeat(tx, organizationId, plan, normalized)
        const [renewed] = await tx
          .update(invitations)
          .set({ role, inviterId, expiresAt: inviteExpiry(), emailSent: false })
          .where(pendingHere(eq(invitations.email, normalized)))
          .returning()
        if (renewed) return toPending(renewed)
        const [created] = await tx
          .insert(invitations)
          .values({
            organizationId,
            email: normalized,
            role,
            status: 'pending',
            inviterId,
            expiresAt: inviteExpiry(),
            emailSent: false,
          })
          .returning()
        if (!created) throw new Error('[data] the invitation was not stored')
        return toPending(created)
      })
    },

    resend: (id) =>
      transaction(async (tx) => {
        const plan = await lockedPlan(tx, organizationId)
        const [invitation] = await tx
          .select({ email: invitations.email })
          .from(invitations)
          .where(pendingHere(eq(invitations.id, id)))
        if (!invitation) return undefined
        if (plan) await requireSeat(tx, organizationId, plan, invitation.email)
        const [row] = await tx
          .update(invitations)
          .set({ expiresAt: inviteExpiry() })
          .where(pendingHere(eq(invitations.id, id)))
          .returning()
        return row ? toPending(row) : undefined
      }),

    async markEmailSent(id) {
      const [row] = await db
        .update(invitations)
        .set({ emailSent: true })
        .where(pendingHere(eq(invitations.id, id)))
        .returning()
      return row ? toPending(row) : undefined
    },

    async cancel(id) {
      const rows = await db
        .update(invitations)
        .set({ status: 'canceled' })
        .where(pendingHere(eq(invitations.id, id)))
        .returning({ id: invitations.id })
      return rows.length > 0
    },

    changeRole: (actorUserId, email, role) =>
      transaction(async (tx) => {
        const target = await checked(tx, actorUserId, email, (t) => ({
          kind: 'role',
          target: t,
          role,
        }))
        await tx.update(members).set({ role }).where(eq(members.id, target.id))
        return toMember({ ...target, role })
      }),

    remove: (actorUserId, email) =>
      transaction(async (tx) => {
        const target = await checked(tx, actorUserId, email, (t) => ({ kind: 'remove', target: t }))
        await tx.delete(members).where(eq(members.id, target.id))
        await revokeGrants(tx, organizationId, target.userId)
      }),
  }
}
