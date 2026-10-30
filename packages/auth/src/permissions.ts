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
} as const

export type Resource = keyof typeof statements
export type Permissions = { [R in Resource]?: readonly (typeof statements)[R][number][] }

export const ac = createAccessControl(statements)

export const roles = {
  owner: ac.newRole({ ...ownerAc.statements, billing: ['read', 'manage'], usage: ['read'] }),
  admin: ac.newRole({ ...adminAc.statements, billing: ['read', 'manage'], usage: ['read'] }),
  member: ac.newRole({ ...memberAc.statements, usage: ['read'] }),
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
