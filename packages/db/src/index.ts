// @arrakit/db: the only workspace allowed to import drizzle-orm, pg, pg-boss, PGlite and the S3 SDK.
// Exposes openData() / forOrganization() (docs/spec/platform.md section 3) to the rest of the monorepo.
export { openData, type Data, type OpenDataOptions, type ScopedData } from './open-data'
export { loadDataConfig, type DataConfig, type S3Config } from './config'
export {
  connect,
  defaultMigrationsFolder,
  type Connection,
  type ConnectionConfig,
  type Database,
} from './connection'
export type { DataContext } from './context'
export * from './errors'
export { isUuid, toOrganizationId, type OrganizationId } from './organization-id'
export { forOrganization, type OrganizationScope } from './organization/index'
export type { OrganizationDb, TenantTableDb, LockStrength } from './organization/tenant-db'
export type { OrganizationRow } from './organization/organization'
export type { StripeRefs } from './organization/billing'
export type {
  AssignableRole,
  MemberView,
  OrganizationMembers,
  OrganizationRole,
  PendingInvitation,
} from './organization/members'
export {
  UsageLimitError,
  type MetricBalance,
  type MetricUsage,
  type OrganizationUsage,
  type TopUp,
  type UsageVerdict,
} from './organization/usage'
export type { Membership } from './data/membership'
export type { OrganizationAdmin } from './data/onboarding'
export { revokeGrants } from './data/organizations'
export type { InvitationForPerson } from './data/invitations'
export {
  SIGN_IN_METHODS,
  type Account,
  type AccountChanges,
  type SignInMethod,
} from './data/account'
export { health, type HealthReport } from './health'
export { authDatabase, type AuthDatabase } from './auth-database'
export * from './jobs/types'
export * from './storage/types'
export { toFileKey, toFolderPrefix } from './storage/file-key'
export { ACCOUNT_LANGUAGES, TENANCY_EXCEPTIONS, type AccountLanguage } from './schema/index'
