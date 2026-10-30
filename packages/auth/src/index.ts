// @arrakit/auth: Better Auth server configuration (magic link, Google, Microsoft, organization,
// OAuth provider for MCP) and shared role definitions. The database adapter is injected by the
// caller (apps/api gets it from @arrakit/db), so this package never imports drizzle or pg.
export * from './roles'
export * from './config'
export type { AuthDeps, InvitationForMail } from './deps'
export { createAuth, ORGANIZATION_SCHEMA, type Auth } from './auth'
export { microsoftVouches } from './social'
