export const AUTH_BASE_PATH = '/api/auth'
const MCP_PATH = '/api/mcp'
export const MAGIC_LINK_MINUTES = 15
export const ORGANIZATION_CLAIM = 'organization_id'
export const COOKIE_PREFIX = 'arrakit'
export const MICROSOFT_UNVERIFIED = 'email_not_verified'

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
  const wantsGoogle =
    env.NODE_ENV === 'production' || !!value('GOOGLE_CLIENT_ID') || !!value('GOOGLE_CLIENT_SECRET')
  const wantsMicrosoft = !!value('MICROSOFT_CLIENT_ID') || !!value('MICROSOFT_CLIENT_SECRET')
  if (wantsGoogle) {
    for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])
      if (!value(name)) missing.push(name)
  }
  if (wantsMicrosoft) {
    for (const name of ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'])
      if (!value(name)) missing.push(name)
  }
  if (missing.length > 0) throw new Error(`[auth] missing env: ${missing.join(', ')}`)

  const secret = env.BETTER_AUTH_SECRET!
  if (secret.length < 32)
    throw new Error('[auth] BETTER_AUTH_SECRET must be at least 32 characters')
  const baseURL = originOf(env.BETTER_AUTH_URL!, 'BETTER_AUTH_URL')
  const webOrigin = value('WEB_URL') ? originOf(env.WEB_URL!, 'WEB_URL') : baseURL

  return {
    secret,
    baseURL,
    webOrigin,
    trustedOrigins: [...new Set([baseURL, webOrigin])],
    google: wantsGoogle
      ? { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! }
      : undefined,
    microsoft: wantsMicrosoft
      ? { clientId: env.MICROSOFT_CLIENT_ID!, clientSecret: env.MICROSOFT_CLIENT_SECRET! }
      : undefined,
  }
}

export const mcpResourceURL = (baseURL: string) => new URL(MCP_PATH, baseURL).toString()
export const oauthIssuer = (baseURL: string) => new URL(AUTH_BASE_PATH, baseURL).toString()

export const isTrustedOrigin = (origin: string | null | undefined, trusted: readonly string[]) =>
  typeof origin === 'string' && trusted.includes(origin)
