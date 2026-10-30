import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { testUtils } from 'better-auth/plugins'
import { describe, expect, it } from 'vitest'

// Smoke test of the Better Auth testUtils plugin, the way feature tests create users and sessions.
describe('Better Auth testUtils', () => {
  it('creates a user and logs in without going through magic link', async () => {
    const auth = betterAuth({
      secret: 'test-secret-test-secret-test-secret-00',
      baseURL: 'http://localhost:4200',
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      plugins: [testUtils()],
    })
    const { test } = await auth.$context
    const user = await test.saveUser(test.createUser({ email: 'ana@example.com', name: 'Ana' }))
    const { headers } = await test.login({ userId: user.id })

    const session = await auth.api.getSession({ headers })
    expect(session?.user.email).toBe('ana@example.com')
  })
})
