import { createAccessControl } from 'better-auth/plugins/access'
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from 'better-auth/plugins/organization/access'

export const statements = {
  ...defaultStatements,
  billing: ['read', 'manage'],
  usage: ['read'],
  workspace: ['read', 'create', 'update', 'delete'],
  file: ['read', 'upload', 'update', 'delete'],
  /** Everyone sees the tasks they started; `read` sees every task of the organization. */
  task: ['read'],
} as const

export type Resource = keyof typeof statements
export type Permissions = { [R in Resource]?: readonly (typeof statements)[R][number][] }

export const ac = createAccessControl(statements)

export const roles = {
  owner: ac.newRole({
    ...ownerAc.statements,
    billing: ['read', 'manage'],
    usage: ['read'],
    workspace: statements.workspace,
    file: statements.file,
    task: statements.task,
  }),
  admin: ac.newRole({
    ...adminAc.statements,
    billing: ['read', 'manage'],
    usage: ['read'],
    workspace: statements.workspace,
    file: statements.file,
    task: statements.task,
  }),
  member: ac.newRole({
    ...memberAc.statements,
    usage: ['read'],
    workspace: ['read', 'create'],
    file: ['read', 'upload'],
  }),
}

export const STATIC_ROLES = ['owner', 'admin', 'member'] as const
export type StaticRole = (typeof STATIC_ROLES)[number]

export const isStaticRole = (role: string): role is StaticRole =>
  (STATIC_ROLES as readonly string[]).includes(role)

/** The roles in a member's role string (Better Auth stores several as `a,b`). */
export const rolesOf = (role: string): string[] =>
  role
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)

export const isOwnerRole = (role: string) => rolesOf(role).includes('owner')

/** What a role string grants: the union of its static and custom roles. Unknown roles grant nothing. */
export function permissionsOf(role: string, custom: Record<string, Permissions> = {}): Permissions {
  const granted: Record<string, Set<string>> = {}
  for (const name of rolesOf(role)) {
    const permissions = isStaticRole(name)
      ? (roles[name].statements satisfies Permissions)
      : custom[name]
    for (const [resource, actions] of Object.entries(permissions ?? {})) {
      const set = (granted[resource] ??= new Set())
      for (const action of actions ?? []) set.add(action)
    }
  }
  return Object.fromEntries(
    Object.entries(granted)
      .filter(([, actions]) => actions.size > 0)
      .map(([resource, actions]) => [resource, [...actions]]),
  ) as Permissions
}

/** True when `granted` holds every action `wanted` names. */
export function allows(granted: Permissions, wanted: Permissions): boolean {
  return Object.entries(wanted).every(([resource, actions]) => {
    const held: readonly string[] = granted[resource as Resource] ?? []
    return (actions ?? []).every((action) => held.includes(action))
  })
}

/** Parses a custom role's stored `permission` JSON; anything malformed grants nothing. */
export function parsePermissions(raw: string): Permissions {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object') return {}
  const known: Record<string, readonly string[]> = statements
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .filter(([resource, actions]) => resource in known && Array.isArray(actions))
      .map(([resource, actions]) => [
        resource,
        (actions as unknown[]).filter(
          (action): action is string =>
            typeof action === 'string' && known[resource]!.includes(action),
        ),
      ]),
  ) as Permissions
}

/** An organization's custom roles by name, from their stored rows. */
export const customRoleMap = (
  rows: readonly { role: string; permission: string }[],
): Record<string, Permissions> =>
  Object.fromEntries(rows.map((row) => [row.role, parsePermissions(row.permission)]))

export interface MemberChange {
  actorRole: string
  /** The member changed or removed; absent for an invitation. */
  targetRole?: string
  /** The role given; absent for a removal. */
  newRole?: string
  /** The actor changes or removes themselves. */
  self: boolean
  /** The organization's custom roles. */
  custom: Record<string, Permissions>
  /** What the actor holds. */
  actorPermissions: Permissions
}

/**
 * Why the change is refused, or null. Better Auth already checks the member, invitation and
 * role-name permissions and keeps the sole owner; these are the rules it does not have.
 */
export function memberChangeRefusal(change: MemberChange): string | null {
  const { actorRole, actorPermissions, targetRole, newRole, self, custom } = change
  if (newRole !== undefined && rolesOf(newRole).includes('owner')) {
    return 'No one is made owner: the organization has its creator.'
  }
  if (targetRole !== undefined && isOwnerRole(targetRole)) {
    return self
      ? "You are the organization's only owner."
      : "Only the owner changes the owner's role or seat."
  }
  if (isOwnerRole(actorRole)) return null

  if (newRole !== undefined && rolesOf(newRole).includes('admin')) {
    return 'Only the owner names admins.'
  }
  if (targetRole !== undefined && !self && rolesOf(targetRole).includes('admin')) {
    return 'Only the owner demotes or removes an admin.'
  }
  if (newRole !== undefined && !allows(actorPermissions, permissionsOf(newRole, custom))) {
    return "You can't give permissions you don't have."
  }
  if (
    targetRole !== undefined &&
    !self &&
    !allows(actorPermissions, permissionsOf(targetRole, custom))
  ) {
    return 'Only the owner changes someone with more rights than yours.'
  }
  return null
}

/** Columns of the organization tables Better Auth reads and returns besides its own (server and client). */
export const organizationSchema = {
  organization: {
    additionalFields: {
      plan: { type: 'string', input: false, required: true, defaultValue: 'free' },
    },
  },
  member: {
    additionalFields: {
      termsAcceptedAt: { type: 'date', input: false, required: false },
    },
  },
  invitation: {
    additionalFields: {
      emailSent: { type: 'boolean', input: false, required: true, defaultValue: false },
    },
  },
} as const
