// @arrakit/auth: Better Auth server configuration (magic link, Google, Microsoft, organization,
// OAuth provider for MCP) and shared role definitions. The database adapter is injected by the
// caller (apps/api gets it from @arrakit/db), so this package never imports drizzle or pg.
export const ROLES = ['owner', 'admin', 'member'] as const
export type Role = (typeof ROLES)[number]
