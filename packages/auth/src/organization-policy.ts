import { type Permissions, allows, isOwnerRole, permissionsOf, rolesOf } from './permissions'

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
}

/**
 * Why the change is refused, or null. Better Auth already checks the member, invitation and
 * role-name permissions and keeps the sole owner; these are the rules it does not have.
 */
export function memberChangeRefusal(change: MemberChange): string | null {
  const { actorRole, targetRole, newRole, self, custom } = change
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
  const rights = permissionsOf(actorRole, custom)
  if (newRole !== undefined && !allows(rights, permissionsOf(newRole, custom))) {
    return "You can't give permissions you don't have."
  }
  if (targetRole !== undefined && !self && !allows(rights, permissionsOf(targetRole, custom))) {
    return 'Only the owner changes someone with more rights than yours.'
  }
  return null
}
