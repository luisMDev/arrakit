import type { Auth } from './auth'
import type { MemberClaims } from './permissions'

export const SUPABASE_TOKEN_SECONDS = 600

/** Signs the token Supabase services accept for a member, carrying the claims RLS reads. */
export async function signSupabaseToken(
  auth: Auth,
  claims: MemberClaims,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const iat = Math.floor(now.getTime() / 1000)
  const exp = iat + SUPABASE_TOKEN_SECONDS
  const { token } = await auth.api.signJWT({
    body: { payload: { ...claims, aud: 'authenticated', iat, exp } },
  })
  return { token, expiresAt: new Date(exp * 1000) }
}
