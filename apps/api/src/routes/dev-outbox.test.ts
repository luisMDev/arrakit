import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type TestApp, createTestApp } from '../testing/app'

describe('the dev outbox', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  it('lists the mail sent to an address, newest first, and clears it', async () => {
    for (const email of ['ana@acme.com', 'bo@acme.com', 'ana@acme.com']) {
      const res = await t.request('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:4200' },
        body: JSON.stringify({ email, callbackURL: '/profile' }),
      })
      expect(res.status).toBe(200)
    }

    const listed = (await (await t.request('/api/dev/outbox?to=ana@acme.com')).json()) as {
      to: string
      text: string
    }[]
    expect(listed).toHaveLength(2)
    expect(listed[0]?.text).toBe(t.sent.at(-1)?.text)
    expect(listed[0]?.text).toContain('/api/auth/magic-link/verify?token=')

    expect((await t.request('/api/dev/outbox', { method: 'DELETE' })).status).toBe(204)
    expect(await (await t.request('/api/dev/outbox')).json()).toEqual([])
  })

  it('does not exist in production', async () => {
    const prod = await createTestApp({
      env: {
        NODE_ENV: 'production',
        GOOGLE_CLIENT_ID: 'g',
        GOOGLE_CLIENT_SECRET: 's',
      },
    })
    expect((await prod.request('/api/dev/outbox')).status).toBe(404)
    await prod.close()
  })
})
