import { members } from '@arrakit/db/schema'
import type { Plan } from '@arrakit/plans'

import type { TestApp } from './app'

export interface Person {
  headers: Headers
  userId: string
  email: string
}

interface RawClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

/** Raw SQL against the test PGlite, for state no procedure creates (expiry, subscriptions). */
export function sqlOf(t: TestApp) {
  const client = (t.data.db as unknown as { $client: RawClient }).$client
  return (text: string, params: unknown[] = []) => client.query(text, params)
}

/** A signed-in person who created their organization through the API, then put on `plan`. */
export async function ownerOf(t: TestApp, email: string, plan: Plan = 'team', name = '') {
  const person = await t.signIn({ email, name })
  const organization = await t
    .client(person.headers)
    .organizations.create({ name: '', termsAccepted: true })
  if (plan !== 'free') await t.data.forOrganization(organization.id).setPlan(plan)
  return { ...person, email, organization, organizationId: organization.id }
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

/** Someone added straight to the organization, past invitations and seat limits. */
export async function joinAs(
  t: TestApp,
  organizationId: string,
  email: string,
  role: 'admin' | 'member',
): Promise<Person> {
  const person = await t.signIn({ email })
  await t.data.db.insert(members).values({ organizationId, userId: person.userId, role })
  return { ...person, email }
}
