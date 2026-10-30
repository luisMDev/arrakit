import { type TestData, openTestData } from '@arrakit/db/testing'
import type { Mail } from '@arrakit/emails'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createAuth } from './auth'
import { loadAuthConfig } from './config'

const WEB = 'http://localhost:5200'

describe('createAuth on the real schema (PGlite)', () => {
  let data: TestData
  let auth: ReturnType<typeof createAuth>
  const sent: Mail[] = []

  beforeAll(async () => {
    data = await openTestData()
    auth = createAuth({
      config: loadAuthConfig({ BETTER_AUTH_SECRET: 'x'.repeat(32), BETTER_AUTH_URL: WEB }),
      database: data.authDatabase,
      mailer: { send: async (mail) => void sent.push(mail) },
      invitationFor: async () => null,
      organizationOf: (userId) => data.organizationOf(userId),
      testing: true,
    })
  })
  afterAll(() => data.close())

  it('creates users and sessions through testUtils', async () => {
    const { test } = await auth.$context
    const user = await test.saveUser(test.createUser({ email: 'ana@acme.com', name: 'Ana' }))
    const { headers } = await test.login({ userId: user.id })
    const session = await auth.api.getSession({ headers })
    expect(session?.user.email).toBe('ana@acme.com')
    expect(session?.user.language).toBe('en')
  })

  it('has no organization routes and closes the session-to-JWT route', async () => {
    const list = await auth.handler(new Request(`${WEB}/api/auth/organization/list`))
    expect(list.status).toBe(404)
    const token = await auth.handler(new Request(`${WEB}/api/auth/token`))
    expect(token.status).toBe(404)
  })

  it('sends a magic link through the injected mailer', async () => {
    const res = await auth.handler(
      new Request(`${WEB}/api/auth/sign-in/magic-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: WEB },
        body: JSON.stringify({ email: 'lucia@alder.vc', callbackURL: `${WEB}/app` }),
      }),
    )
    expect(res.status).toBe(200)
    expect(sent.at(-1)?.to).toBe('lucia@alder.vc')
    expect(sent.at(-1)?.text).toContain('/api/auth/magic-link/verify?token=')
  })
})
