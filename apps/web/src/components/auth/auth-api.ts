import type { AuthProviders } from '@arrakit/contract'

import { statusOf } from '#/lib/api-errors'
import { authCall } from '#/lib/auth-call'
import { authClient } from '#/lib/auth-client'

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

const absolute = (path: string) => new URL(path, document.baseURI).href

/** Resolves `false` when Better Auth refuses the address (400), `true` once the link is sent. */
export async function sendMagicLink(email: string, landing: string): Promise<boolean> {
  try {
    await authCall(
      authClient.signIn.magicLink({
        email,
        callbackURL: absolute(landing),
        errorCallbackURL: absolute(refusedLanding(landing)),
      }),
    )
    return true
  } catch (err) {
    if (statusOf(err) === 400) return false
    throw err
  }
}

/** The provider's sign-in page to send the window to. */
export async function socialSignInUrl(provider: SocialProvider, landing: string): Promise<string> {
  const { url } = await authCall(
    authClient.signIn.social({
      provider,
      callbackURL: absolute(landing),
      errorCallbackURL: absolute(refusedLanding(landing, provider)),
      disableRedirect: true,
    }),
  )
  if (!url) throw new Error('[auth] the social sign-in named no provider page')
  return url
}
