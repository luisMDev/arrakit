import { insertMember, rawSql } from '@arrakit/db/testing'
import type { Plan } from '@arrakit/plans'

import { type TestApp, withOrigin } from './app'

export interface Person {
  headers: Headers
  userId: string
  email: string
}

/** Raw SQL against the test PGlite, for state no procedure creates (expiry, subscriptions). */
export const sqlOf = (t: TestApp) => rawSql(t.data)

export interface AuthAnswer<T = Record<string, unknown>> {
  status: number
  body: T & { message?: string; code?: string }
}

/** Calls Better Auth over HTTP as the web does (`/api/auth/*`): a body POSTs, a query GETs. */
export function authApi(t: TestApp, headers: Headers, prefix = '') {
  async function call<T>(path: string, init: RequestInit): Promise<AuthAnswer<T>> {
    const res = await t.request(`/api/auth/${prefix}${path}`, init)
    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : null) as AuthAnswer<T>['body'] }
  }
  const sent = withOrigin(headers)
  return {
    post: <T = Record<string, unknown>>(path: string, body: Record<string, unknown> = {}) => {
      const postHeaders = new Headers(sent)
      postHeaders.set('content-type', 'application/json')
      return call<T>(path, { method: 'POST', headers: postHeaders, body: JSON.stringify(body) })
    },
    get: <T = Record<string, unknown>>(path: string, query: Record<string, string> = {}) =>
      call<T>(`${path}?${new URLSearchParams(query)}`, { headers: sent }),
  }
}

/** Better Auth's organization plugin (`/api/auth/organization/*`). */
export const orgApi = (t: TestApp, headers: Headers) => authApi(t, headers, 'organization/')

export interface CreatedOrganization {
  id: string
  name: string
  slug: string
  plan: Plan
}

/** Creates an organization as the web does; the auth hook names its slug. */
export async function createOrganization(
  t: TestApp,
  headers: Headers,
  name = '',
  extra: Record<string, unknown> = { termsAccepted: true },
): Promise<CreatedOrganization> {
  const created = await orgApi(t, headers).post<CreatedOrganization>('create', {
    name,
    slug: 'pending',
    ...extra,
  })
  if (created.status !== 200) throw new Error(`create refused: ${JSON.stringify(created)}`)
  const { id, slug, plan } = created.body
  return { id, name: created.body.name, slug, plan }
}

/** A signed-in person who created their organization through the API, then put on `plan`. */
export async function ownerOf(t: TestApp, email: string, plan: Plan = 'team', name = '') {
  const person = await t.signIn({ email, name })
  const organization = await createOrganization(t, person.headers)
  if (plan !== 'free') await t.data.asSystem(organization.id).setPlan(plan)
  return { ...person, email, organization, organizationId: organization.id }
}

/** Someone invited by `inviter` into `inviter.organizationId`, who accepted. */
export async function joined(
  t: TestApp,
  inviter: Person & { organizationId: string },
  email: string,
  role = 'member',
  name = '',
): Promise<Person & { memberId: string }> {
  const invited = await orgApi(t, inviter.headers).post<{ id: string }>('invite-member', {
    email,
    role,
    organizationId: inviter.organizationId,
  })
  if (invited.status !== 200) throw new Error(`invite refused: ${JSON.stringify(invited)}`)
  const person = await t.signIn({ email, name })
  const accepted = await orgApi(t, person.headers).post<{ member: { id: string } }>(
    'accept-invitation',
    { invitationId: invited.body.id },
  )
  if (accepted.status !== 200) throw new Error(`accept refused: ${JSON.stringify(accepted)}`)
  return { ...person, email, memberId: accepted.body.member.id }
}

/** Someone added straight to the organization, past invitations and seat limits. */
export async function joinAs(
  t: TestApp,
  organizationId: string,
  email: string,
  role: string,
): Promise<Person> {
  const person = await t.signIn({ email })
  await insertMember(t.data, organizationId, person.userId, role)
  return { ...person, email }
}
