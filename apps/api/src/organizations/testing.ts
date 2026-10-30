import type { Plan } from '@arrakit/plans'

import { TEST_WEB_ORIGIN, type TestApp } from '../testing/app'

export interface Person {
  headers: Headers
  userId: string
  email: string
}

interface RawClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

/** Raw SQL against the test PGlite, for state no procedure creates (plans, expiry, subscriptions). */
export function sqlOf(t: TestApp) {
  const client = (t.data.db as unknown as { $client: RawClient }).$client
  return (text: string, params: unknown[] = []) => client.query(text, params)
}

export async function setPlan(t: TestApp, organizationId: string, plan: Plan) {
  await sqlOf(t)('update organizations set plan = $1 where id = $2', [plan, organizationId])
}

/** A signed-in person who created their organization (Free unless `plan` is given). */
export async function ownerOf(t: TestApp, email: string, plan: Plan = 'team', name = '') {
  const person = await t.signIn({ email, name })
  const organization = await t
    .client(person.headers)
    .organizations.create({ name: '', termsAccepted: true })
  if (plan !== 'free') await setPlan(t, organization.id, plan)
  return { ...person, email, organization }
}

/** Someone invited by `inviter` who accepted. */
export async function joined(
  t: TestApp,
  inviter: Person,
  email: string,
  role: 'admin' | 'member' = 'member',
  name = '',
): Promise<Person> {
  const invitation = await t.client(inviter.headers).invitations.invite({ email, role })
  const person = await t.signIn({ email, name })
  await t.client(person.headers).invitations.accept({ id: invitation.id })
  return { ...person, email }
}

/** The magic link in the newest mail to `to`. */
export function linkFor(t: TestApp, to: string): string {
  const mail = [...t.sent].reverse().find((m) => [m.to].flat().includes(to))
  const link = mail?.text?.match(/https?:\/\/\S+/)?.[0]
  if (!link) throw new Error(`no link mailed to ${to}`)
  return link
}

/** Signs in through a real magic link with `userAgent`, as a browser on a device would. */
export async function signInFrom(t: TestApp, email: string, userAgent: string): Promise<Headers> {
  const asked = await t.app.request('/api/auth/sign-in/magic-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: TEST_WEB_ORIGIN },
    body: JSON.stringify({ email, callbackURL: '/app' }),
  })
  if (!asked.ok) throw new Error(`magic link refused: ${asked.status}`)
  const link = new URL(linkFor(t, email))
  const opened = await t.app.request(link.pathname + link.search, {
    headers: { 'user-agent': userAgent },
    redirect: 'manual',
  })
  const cookies = opened.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
  return new Headers({ cookie: cookies, origin: TEST_WEB_ORIGIN, 'user-agent': userAgent })
}
