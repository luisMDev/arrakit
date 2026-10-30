import type { AppDeps } from '../deps'

/**
 * Sends the invite as a Better Auth magic link whose callback is the join page; the magic link
 * sender recognises the join callback and writes the member email instead of the sign-in one.
 * The inviter's headers make the trusted-origin and email checks apply.
 */
export async function sendInviteMail(
  deps: AppDeps,
  headers: Headers,
  invitation: { id: string; email: string },
): Promise<void> {
  const join = `${deps.env.webUrl}/join/${encodeURIComponent(invitation.id)}`
  await deps.auth.api.signInMagicLink({
    body: { email: invitation.email, callbackURL: join, errorCallbackURL: join },
    headers,
  })
}
