// @arrakit/db: the only workspace allowed to import drizzle-orm, pg, pg-boss, PGlite and the S3 SDK.
// Exposes openData() / forOrganization() (docs/spec/platform.md section 3) to the rest of the monorepo.
export { openData, type Data, type ScopedData } from './open-data'
export { loadDataConfig } from './config'
export { DomainError } from './errors'
export {
  forOrganization,
  type OrganizationRow,
  type OrganizationScope,
  type StripeRefs,
} from './organization/index'
export { UsageLimitError, type MetricUsage, type TopUp } from './organization/usage'
export type { Membership } from './data/membership'
export type { Account } from './data/account'
export { authDatabase } from './auth-database'
export { WORKER_RETRY_POLICY, type Jobs } from './jobs/types'
export type { Storage } from './storage/types'
