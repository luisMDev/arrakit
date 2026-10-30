export * from './auth'
export * from './oauth'
export * from './organizations'
export * from './usage'

/** Tables allowed without `organization_id` (docs/spec/platform.md 2.10). */
export const TENANCY_EXCEPTIONS = [
  'organizations',
  'users',
  'sessions',
  'accounts',
  'verifications',
  'jwks',
  'oauth_clients',
  'oauth_resources',
  'oauth_client_resources',
  'oauth_refresh_tokens',
  'oauth_access_tokens',
  'oauth_consents',
  'oauth_client_assertions',
  'team_members',
] as const
