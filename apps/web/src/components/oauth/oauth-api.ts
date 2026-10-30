import { authFetch } from '#/components/auth/auth-api'

/** The connector's `client_name`, or its id when it gave none. */
export async function publicClientName(clientId: string): Promise<string> {
  const body = await authFetch<{ client_id: string; client_name?: string }>(
    `/oauth2/public-client?${new URLSearchParams({ client_id: clientId })}`,
  )
  return body.client_name || body.client_id
}

/** Allows or denies the request (`oauthQuery`, exactly as received); resolves to where to go next. */
export async function consent(accept: boolean, oauthQuery: string): Promise<string> {
  const body = await authFetch<{ url?: string; redirect_uri?: string }>('/oauth2/consent', {
    accept,
    oauth_query: oauthQuery,
  })
  const url = body.url ?? body.redirect_uri
  if (!url) throw new Error('[oauth] the consent answer named no redirect')
  return url
}
