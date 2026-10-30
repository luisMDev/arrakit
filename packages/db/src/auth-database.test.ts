import { betterAuth } from 'better-auth'
import { organization, testUtils } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sessions, users } from './schema/index'
import { type TestData, openTestData } from './testing'

const buildAuth = (data: TestData) =>
  betterAuth({
    secret: 'test-secret-test-secret-test-secret-00',
    baseURL: 'http://localhost:4200',
    basePath: '/api/auth',
    database: data.authDatabase,
    telemetry: { enabled: false },
    plugins: [
      organization({
        creatorRole: 'owner',
        schema: {
          member: {
            additionalFields: {
              termsAcceptedAt: { type: 'date', required: false, input: false },
            },
          },
        },
      }),
      testUtils(),
    ],
  })

describe('the Better Auth adapter over the Drizzle schema', () => {
  let data: TestData
  let auth: ReturnType<typeof buildAuth>

  beforeAll(async () => {
    data = await openTestData()
    auth = buildAuth(data)
  })
  afterAll(() => data.close())

  const signedIn = async (email: string) => {
    const { test } = await auth.$context
    const user = await test.saveUser(test.createUser({ email, name: 'Ana' }))
    const { headers } = await test.login({ userId: user.id })
    return { userId: user.id, headers }
  }

  it('writes people and their sessions to users and sessions', async () => {
    const { userId, headers } = await signedIn('ana@acme.com')

    const session = await auth.api.getSession({ headers })
    expect(session?.user.id).toBe(userId)
    const [row] = await data.db.select().from(users).where(eq(users.id, userId))
    expect(row?.language).toBe('en')
    expect(row?.emailProductNews).toBe(false)
    expect(await data.db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(1)
  })

  it('ends the sessions of a deleted person', async () => {
    const { userId, headers } = await signedIn('gone@acme.com')
    expect(await data.deleteAccount(userId)).toBe(true)

    expect(await auth.api.getSession({ headers })).toBeNull()
    expect(await data.db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0)
  })

  it('reads an organization made by createOrganization, with the terms stamp', async () => {
    const { userId, headers } = await signedIn('owner@birch.vc')
    const made = await data.createOrganization('Birch', { userId, termsAccepted: true })

    const full = await auth.api.getFullOrganization({
      headers,
      query: { organizationId: made.id },
    })
    expect(full?.id).toBe(made.id)
    expect(full?.slug).toBe(made.slug)
    const owner = full?.members.find((member) => member.userId === userId) as
      { role: string; termsAcceptedAt?: Date | null } | undefined
    expect(owner?.role).toBe('owner')
    expect(owner?.termsAcceptedAt).toBeInstanceOf(Date)
  })
})
