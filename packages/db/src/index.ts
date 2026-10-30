// @arrakit/db: the only workspace allowed to import drizzle-orm, pg, pg-boss, PGlite and the S3 SDK.
// Exposes openData() / forOrganization() (docs/spec/platform.md section 3) to the rest of the monorepo.
export { connect } from './connection'
export type { Connection, ConnectionConfig, Database } from './connection'
