// @arrakit/db: the only workspace allowed to import drizzle-orm, pg, pg-boss, PGlite and the S3 SDK.
// Exposes openData() / forOrganization() (docs/spec/platform.md section 3) to the rest of the monorepo.
export { openData, type Data, type OpenDataOptions, type ScopedData } from './open-data'
export { loadDataConfig, type DataConfig, type S3Config } from './config'
export { connect, type Connection, type ConnectionConfig, type Database } from './connection'
export type { DataContext } from './context'
export type { DataLog } from './log'
export * from './errors'
export { toOrganizationId, type OrganizationId } from './organization-id'
export { forOrganization, type OrganizationScope } from './organization/index'
export type { OrganizationRow } from './organization/organization'
export type { StripeRefs } from './organization/billing'
export type { MemberView, OrganizationMembers } from './organization/members'
export type { CustomRole } from './organization/roles'
export type { TeamMemberView } from './organization/teams'
export {
  UsageLimitError,
  type MetricBalance,
  type MetricUsage,
  type OrganizationUsage,
  type TopUp,
  type UsageVerdict,
} from './organization/usage'
export type { Membership } from './data/membership'
export type { InvitationForPerson } from './data/invitations'
export type { Account, AccountChanges } from './data/account'
export { health, type HealthReport } from './health'
export { authDatabase, type AuthDatabase } from './auth-database'
export * from './jobs/types'
export * from './storage/types'
