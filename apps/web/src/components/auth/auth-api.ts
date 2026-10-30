import type { AuthProviders } from '@arrakit/contract'
import { createContext, useContext } from 'react'

import { client } from '#/lib/orpc'

export type SocialProvider = 'google' | 'microsoft'

export const PROVIDERS_UNKNOWN: AuthProviders = { google: true, microsoft: false }

export class EmailRefusedError extends Error {
  override name = 'EmailRefusedError'
}

export class AuthRequestError extends Error {
  override name = 'AuthRequestError'
  constructor(readonly status: number) {
    super(`The auth API answered ${status}`)
  }
}

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

export interface AuthApi {
  sendMagicLink(email: string, landing: string): Promise<void>
  signInWith(provider: SocialProvider, landing: string): Promise<void>
  providers(): Promise<AuthProviders>
}

const absolute = (path: string) => new URL(path, document.baseURI).href

async function post(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`/api/auth${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new AuthRequestError(res.status)
  return res
}

export function createHttpAuthApi(
  options: {
    loadProviders?: () => Promise<AuthProviders>
    redirect?: (url: string) => void
  } = {},
): AuthApi {
  const loadProviders = options.loadProviders ?? (() => client.authProviders.get())
  const redirect =
    options.redirect ??
    ((url: string) => {
      window.location.href = url
    })
  let knownProviders: Promise<AuthProviders> | null = null

  return {
    async sendMagicLink(email, landing) {
      try {
        await post('/sign-in/magic-link', {
          email,
          callbackURL: absolute(landing),
          errorCallbackURL: absolute(refusedLanding(landing)),
        })
      } catch (err) {
        if (err instanceof AuthRequestError && err.status === 400) throw new EmailRefusedError()
        throw err
      }
    },
    async signInWith(provider, landing) {
      const res = await post('/sign-in/social', {
        provider,
        callbackURL: absolute(landing),
        errorCallbackURL: absolute(refusedLanding(landing, provider)),
      })
      const { url } = (await res.json()) as { url: string }
      redirect(url)
    },
    providers() {
      knownProviders ??= loadProviders().catch((err: unknown) => {
        knownProviders = null
        throw err
      })
      return knownProviders.catch(() => PROVIDERS_UNKNOWN)
    },
  }
}

export const httpAuthApi = createHttpAuthApi()

export const AuthApiContext = createContext<AuthApi>(httpAuthApi)

export const useAuthApi = () => useContext(AuthApiContext)
