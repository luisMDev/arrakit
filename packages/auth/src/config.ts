import { type JwtKey, parseJwtKey } from './jwt-key'

export const AUTH_BASE_PATH = '/api/auth'
export const MCP_PATH = '/api/mcp'
export const MAGIC_LINK_MINUTES = 15
export const ORGANIZATION_CLAIM = 'organization_id'
/** The OAuth scope an access token needs to call the MCP server. */
export const MCP_SCOPE = 'mcp'
export const COOKIE_PREFIX = 'arrakit'
export const MICROSOFT_UNVERIFIED = 'email_not_verified'
const PLACEHOLDER_SECRET_PREFIX = 'change-me'

interface OAuthClientConfig {
  clientId: string
  clientSecret: string
}

export interface AuthConfig {
  secret: string
  baseURL: string
  trustedOrigins: string[]
  webOrigin: string
  google?: OAuthClientConfig
  microsoft?: OAuthClientConfig
  /** The fixed key the JWT plugin signs with; it mints and stores its own when unset. */
  jwtKey?: JwtKey
}

type Env = Record<string, string | undefined>

const originOf = (url: string, name: string) => {
  try {
    return new URL(url).origin
  } catch {
    throw new Error(`[auth] ${name} is not a URL: ${JSON.stringify(url)}`)
  }
}

export function loadAuthConfig(env: Env): AuthConfig {
  const value = (name: string) => env[name] || undefined
  const missing: string[] = []
  if (!value('BETTER_AUTH_SECRET')) missing.push('BETTER_AUTH_SECRET')
  if (!value('BETTER_AUTH_URL')) missing.push('BETTER_AUTH_URL')
  const optionalClient = (provider: 'GOOGLE' | 'MICROSOFT'): OAuthClientConfig | undefined => {
    const clientId = value(`${provider}_CLIENT_ID`)
    const clientSecret = value(`${provider}_CLIENT_SECRET`)
    if (clientId && clientSecret) return { clientId, clientSecret }
    if (clientId) missing.push(`${provider}_CLIENT_SECRET`)
    if (clientSecret) missing.push(`${provider}_CLIENT_ID`)
    return undefined
  }
  const google = optionalClient('GOOGLE')
  const microsoft = optionalClient('MICROSOFT')
  if (missing.length > 0) throw new Error(`[auth] missing env: ${missing.join(', ')}`)

  const secret = env.BETTER_AUTH_SECRET!
  if (secret.length < 32)
    throw new Error('[auth] BETTER_AUTH_SECRET must be at least 32 characters')
  if (env.NODE_ENV === 'production' && secret.startsWith(PLACEHOLDER_SECRET_PREFIX))
    throw new Error(
      '[auth] BETTER_AUTH_SECRET is a placeholder; set a long random secret in production',
    )
  const baseURL = originOf(env.BETTER_AUTH_URL!, 'BETTER_AUTH_URL')
  const webOrigin = value('WEB_URL') ? originOf(env.WEB_URL!, 'WEB_URL') : baseURL
  const rawJwtKey = value('BETTER_AUTH_JWT_KEY')

  return {
    secret,
    baseURL,
    webOrigin,
    trustedOrigins: [...new Set([baseURL, webOrigin])],
    google,
    microsoft,
    ...(rawJwtKey ? { jwtKey: parseJwtKey(rawJwtKey) } : {}),
  }
}

export const mcpResourceURL = (baseURL: string) => new URL(MCP_PATH, baseURL).toString()
export const oauthIssuer = (baseURL: string) => new URL(AUTH_BASE_PATH, baseURL).toString()

export const isTrustedOrigin = (origin: string | null | undefined, trusted: readonly string[]) =>
  typeof origin === 'string' && trusted.includes(origin)
