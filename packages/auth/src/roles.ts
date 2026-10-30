export const ORGANIZATION_ROLES = ['owner', 'admin', 'member'] as const
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number]
/** Roles that can be given to someone; never 'owner'. */
export const ASSIGNABLE_ROLES = ['admin', 'member'] as const
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

/** Owners and admins manage members, invitations and billing. Case-sensitive. */
export const isAdminRole = (role: string | null | undefined): boolean =>
  role === 'owner' || role === 'admin'

/** Any stored role that is not exactly one of the three reads as 'member' (least privilege). */
export const toOrganizationRole = (role: string): OrganizationRole =>
  (ORGANIZATION_ROLES as readonly string[]).includes(role) ? (role as OrganizationRole) : 'member'

export const ACCOUNT_LANGUAGES = ['en', 'es'] as const
export type AccountLanguage = (typeof ACCOUNT_LANGUAGES)[number]
