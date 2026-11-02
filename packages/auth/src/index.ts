export {
  AUTH_BASE_PATH,
  MCP_PATH,
  MCP_SCOPE,
  ORGANIZATION_CLAIM,
  isTrustedOrigin,
  loadAuthConfig,
  mcpResourceURL,
  oauthIssuer,
  type AuthConfig,
} from './config'
export { createAuth, type Auth, type AuthDeps, type OrganizationDeps } from './auth'
