import { createContext, useContext } from 'react'

import { client } from '#/lib/orpc'

const OAUTH = '/api/auth/oauth2'

export interface OAuthApi {
  /** The connector's name: its `client_name`, or its id when it gave none. */
  publicClient(clientId: string): Promise<{ name: string }>
  /** The signed-in person's organization, or null when they are in none. */
  currentOrganization(): Promise<{ name: string } | null>
  /**
   * Allows or denies the request the consent page was opened with (`oauthQuery`, exactly as
   * received), then sends the window to the client's redirect URI.
   */
  consent(accept: boolean, oauthQuery: string): Promise<void>
}

export class OAuthRequestError extends Error {
  override name = 'OAuthRequestError'
  constructor(readonly status: number) {
    super(`The OAuth provider answered ${status}`)
  }
}

export function createHttpOAuthApi(options: { redirect?: (url: string) => void } = {}): OAuthApi {
  const redirect =
    options.redirect ??
    ((url: string) => {
      window.location.href = url
    })

  return {
    async publicClient(clientId) {
      const res = await fetch(
        `${OAUTH}/public-client?${new URLSearchParams({ client_id: clientId })}`,
        { credentials: 'include' },
      )
      if (!res.ok) throw new OAuthRequestError(res.status)
      const body = (await res.json()) as { client_id: string; client_name?: string }
      return { name: body.client_name || body.client_id }
    },
    async currentOrganization() {
      const me = await client.me.get()
      return me.organization ? { name: me.organization.name } : null
    },
    async consent(accept, oauthQuery) {
      const res = await fetch(`${OAUTH}/consent`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      })
      if (!res.ok) throw new OAuthRequestError(res.status)
      const body = (await res.json()) as { url?: string; redirect_uri?: string }
      const url = body.url ?? body.redirect_uri
      if (!url) throw new Error('[oauth] the consent answer named no redirect')
      redirect(url)
    },
  }
}

export const OAuthApiContext = createContext<OAuthApi>(createHttpOAuthApi())

export const useOAuthApi = () => useContext(OAuthApiContext)
