export const AUTHORIZE_PATH = '/api/auth/oauth2/authorize'

const AUTHORIZE_PARAMS: ReadonlySet<string> = new Set([
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
  'nonce',
  'prompt',
  'resource',
  'max_age',
  'display',
  'ui_locales',
  'acr_values',
  'login_hint',
  'claims',
])

/**
 * The authorize request that sent the person to the sign-in page, as a path on this origin, or
 * null without a client. Only authorization parameters are kept (better-auth's signature, `ba_*`,
 * `via`, `error` and anything a link added are dropped) and `prompt=login` is removed, since a
 * resumed request with a session would otherwise come straight back here.
 */
export function authorizeResume(search: string): string | null {
  const query = new URLSearchParams(search)
  if (!query.get('client_id')) return null
  const params = new URLSearchParams()
  for (const [name, value] of query) {
    if (AUTHORIZE_PARAMS.has(name)) params.append(name, value)
  }
  const prompt = (params.get('prompt') ?? '').split(' ').filter((p) => p && p !== 'login')
  if (prompt.length > 0) params.set('prompt', prompt.join(' '))
  else params.delete('prompt')
  return `${AUTHORIZE_PATH}?${params}`
}
