import { members } from '@arrakit/db/schema'
import { ORPCError, call, os } from '@orpc/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { BaseContext } from '../orpc/context'
import { requireMember, requireSession } from '../orpc/context'
import { TEST_WEB_ORIGIN, type TestApp, createTestApp } from '../testing/app'

const WEB = TEST_WEB_ORIGIN

describe('Better Auth routes on Hono', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())
  afterEach(() => vi.useRealTimers())

  const me = (headers: Record<string, string>) =>
    t.app.request('/api/rpc/me/get', { method: 'POST', headers })

  async function signedInCookie(email: string) {
    const { headers } = await t.signIn({ email })
    return headers.get('cookie')!
  }

  it('serves the magic link flow through /api/auth and the outbox mailer', async () => {
    const res = await t.app.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { origin: WEB, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'Hono@Acme.com', callbackURL: `${WEB}/profile` }),
    })
    expect(res.status).toBe(200)
    expect(t.sent.at(-1)?.to).toBe('hono@acme.com')
  })

  it('answers get-session with null when signed out', async () => {
    const res = await t.app.request('/api/auth/get-session')
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('closes the organization routes and the token route', async () => {
    for (const path of ['/api/auth/organization/list', '/api/auth/token']) {
      expect((await t.app.request(path)).status).toBe(404)
    }
  })

  it('serves the authorization server metadata', async () => {
    const res = await t.app.request('/.well-known/oauth-authorization-server/api/auth')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { issuer: string }).issuer).toBe(`${WEB}/api/auth`)
  })

  describe('requireSession', () => {
    it('lets a live session through', async () => {
      expect((await me({ cookie: await signedInCookie('live@acme.com') })).status).toBe(200)
    })

    it.each([
      ['no cookie', ''],
      ['a forged token', 'arrakit.session_token=forged.signature'],
      ['an unsigned token', 'arrakit.session_token=unsigned'],
    ])('refuses %s with 401', async (_, cookie) => {
      expect((await me(cookie ? { cookie } : {})).status).toBe(401)
    })

    it('refuses the cookie under another name', async () => {
      const cookie = await signedInCookie('renamed@acme.com')
      const renamed = cookie.replace('arrakit.session_token', 'better-auth.session_token')
      expect((await me({ cookie: renamed })).status).toBe(401)
    })

    it('refuses a cookie signed with another secret', async () => {
      const other = await createTestApp({
        env: { BETTER_AUTH_SECRET: 'another-secret-another-secret-00000' },
      })
      try {
        const { headers } = await other.signIn({ email: 'other@acme.com' })
        expect((await me({ cookie: headers.get('cookie')! })).status).toBe(401)
      } finally {
        await other.close()
      }
    })

    it('refuses an expired session', async () => {
      const cookie = await signedInCookie('expired@acme.com')
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * 24 * 60 * 60 * 1000 })
      expect((await me({ cookie })).status).toBe(401)
    })

    it('refuses the session of a deleted user', async () => {
      const { headers, userId } = await t.signIn({ email: 'deleted@acme.com' })
      const { internalAdapter } = await t.deps.auth.$context
      await internalAdapter.deleteUser(userId)
      expect((await me({ cookie: headers.get('cookie')! })).status).toBe(401)
    })
  })

  describe('requireMember', () => {
    const base = os.$context<BaseContext>()
    const procedure = (level: 'member' | 'admin' | 'owner') =>
      base
        .use(requireSession)
        .use(requireMember(level))
        .handler(({ context }) => context.role)

    const run = (level: 'member' | 'admin' | 'owner', headers?: Headers) =>
      call(procedure(level), undefined, {
        context: { deps: t.deps, data: t.data, headers: headers ?? new Headers() },
      })

    async function withRole(email: string, role: 'owner' | 'admin' | 'member') {
      const owner = await t.signIn({ email: `owner-of-${email}` })
      const org = await t.client(owner.headers).organizations.skip()
      if (role === 'owner') return { headers: owner.headers, organizationId: org.id }
      const { headers, userId } = await t.signIn({ email })
      await t.data.db.insert(members).values({ organizationId: org.id, userId, role })
      return { headers, organizationId: org.id, userId }
    }

    const errorOf = async (promise: Promise<unknown>) => {
      try {
        await promise
      } catch (err) {
        return err as ORPCError<string, unknown>
      }
      throw new Error('expected a refusal')
    }

    it('answers 401 without a session', async () => {
      expect((await errorOf(run('member'))).status).toBe(401)
    })

    it('answers 404 without an organization', async () => {
      const { headers } = await t.signIn({ email: 'orgless@acme.com' })
      const err = await errorOf(run('member', headers))
      expect(err.status).toBe(404)
      expect(err.message).toBe('Not found in your organization.')
    })

    it.each([
      ['owner', 'owner', 'owner'],
      ['owner', 'admin', 'owner'],
      ['admin', 'admin', 'admin'],
      ['member', 'member', 'member'],
    ] as const)('lets a %s through at %s level', async (role, level, _expected) => {
      const { headers } = await withRole(`${role}-${level}@pass.vc`, role)
      expect(await run(level, headers)).toBe(role)
    })

    it('refuses an admin at owner level and a member at admin level', async () => {
      const admin = await withRole('admin@refuse.vc', 'admin')
      const ownerErr = await errorOf(run('owner', admin.headers))
      expect(ownerErr.status).toBe(403)
      expect(ownerErr.message).toBe("Only the organization's owner can do this.")

      const member = await withRole('member@refuse.vc', 'member')
      const adminErr = await errorOf(run('admin', member.headers))
      expect(adminErr.status).toBe(403)
      expect(adminErr.message).toBe('Only an admin of the organization can do this.')
    })

    it('reads the membership fresh: a removed member gets 404 on the next call', async () => {
      const { headers, userId } = await withRole('removed@fresh.vc', 'member')
      expect(await run('member', headers)).toBe('member')
      const { adapter } = await t.deps.auth.$context
      await adapter.delete({ model: 'member', where: [{ field: 'userId', value: userId! }] })
      expect((await errorOf(run('member', headers))).status).toBe(404)
    })

    it('lets a handler-level requirement override a router-level one', async () => {
      const admin = await withRole('admin@override.vc', 'admin')
      const ownerOnly = base
        .use(requireSession)
        .use(requireMember('admin'))
        .use(requireMember('owner'))
        .handler(() => 'ok')
      const err = await errorOf(
        call(ownerOnly, undefined, {
          context: { deps: t.deps, data: t.data, headers: admin.headers },
        }),
      )
      expect(err.status).toBe(403)
    })
  })
})
