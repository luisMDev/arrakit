import type { AuthProviders } from '@arrakit/contract'

import { statusOf } from '#/lib/api-errors'

export type SocialProvider = 'google' | 'microsoft'

export const PROVIDERS_UNKNOWN: AuthProviders = { google: true, microsoft: false }

const OAUTH_AUTHORIZE = '/api/auth/oauth2/authorize?'

export function refusedLanding(landing: string, via?: SocialProvider): string {
  const withVia = (path: string, query: URLSearchParams) => {
    if (via) query.set('via', via)
    const search = query.toString()
    return search ? `${path}?${search}` : path
  }
  if (landing.startsWith(OAUTH_AUTHORIZE)) {
    return withVia('/oauth/signin', new URLSearchParams(landing.slice(OAUTH_AUTHORIZE.length)))
  }
  if (landing === '/signin') return withVia('/signin', new URLSearchParams())
  const query = landing.startsWith('/profile?') ? landing.slice('/profile?'.length) : ''
  return withVia('/signup', new URLSearchParams(query))
}

/**
 * Calls Better Auth's `/api/auth<path>` (a POST when there is a body). A failure rejects with the
 * answer's `status` and Better Auth's own `message`. Not `authClient`: its OAuth provider plugin
 * adds the page's signed query to every POST, which would tie a sign-in on /oauth/signin to it.
 */
export async function authFetch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    `/api/auth${path}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  if (!res.ok) {
    const answer = (await res.json().catch(() => null)) as { message?: unknown } | null
    const message = typeof answer?.message === 'string' ? answer.message : ''
    throw Object.assign(new Error(message), { status: res.status })
  }
  return (await res.json()) as T
}

const absolute = (path: string) => new URL(path, document.baseURI).href

/** Resolves `false` when Better Auth refuses the address (400), `true` once the link is sent. */
export async function sendMagicLink(email: string, landing: string): Promise<boolean> {
  try {
    await authFetch('/sign-in/magic-link', {
      email,
      callbackURL: absolute(landing),
      errorCallbackURL: absolute(refusedLanding(landing)),
    })
    return true
  } catch (err) {
    if (statusOf(err) === 400) return false
    throw err
  }
}

/** The provider's sign-in page to send the window to. */
export async function socialSignInUrl(provider: SocialProvider, landing: string): Promise<string> {
  const { url } = await authFetch<{ url: string }>('/sign-in/social', {
    provider,
    callbackURL: absolute(landing),
    errorCallbackURL: absolute(refusedLanding(landing, provider)),
  })
  return url
}
