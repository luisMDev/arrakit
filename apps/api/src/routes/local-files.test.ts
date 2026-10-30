import { memoryStorage } from '@arrakit/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadApiEnv } from '../env'
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

  it('does not exist in development without the explicit DEV_OUTBOX flag', async () => {
    const dev = await createTestApp({ env: { NODE_ENV: 'development' } })
    expect((await dev.request('/api/dev/outbox')).status).toBe(404)
    expect((await dev.request('/api/dev/outbox', { method: 'DELETE' })).status).toBe(404)
    await dev.close()
  })

  it('does not exist under NODE_ENV=test when DEV_OUTBOX=0', async () => {
    const off = await createTestApp({ env: { DEV_OUTBOX: '0' } })
    expect((await off.request('/api/dev/outbox')).status).toBe(404)
    await off.close()
  })

  it('exists in development only with DEV_OUTBOX=1', async () => {
    const dev = await createTestApp({ env: { NODE_ENV: 'development', DEV_OUTBOX: '1' } })
    expect((await dev.request('/api/dev/outbox')).status).toBe(200)
    await dev.close()
  })

  it('refuses DEV_OUTBOX=1 in production at boot', () => {
    expect(() => loadApiEnv({ NODE_ENV: 'production', DEV_OUTBOX: '1' })).toThrow(/DEV_OUTBOX/)
  })

  it('defaults to on only under NODE_ENV=test', () => {
    expect(loadApiEnv({ NODE_ENV: 'test' }).DEV_OUTBOX).toBe('1')
    expect(loadApiEnv({ NODE_ENV: 'development' }).DEV_OUTBOX).toBe('0')
    expect(loadApiEnv({}).DEV_OUTBOX).toBe('0')
    expect(loadApiEnv({ NODE_ENV: 'production' }).DEV_OUTBOX).toBe('0')
  })
})

describe('the local storage presigned URLs', () => {
  const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e'

  it('serves a signed GET and PUT through the API, and refuses unsigned access', async () => {
    const storage = memoryStorage({
      signing: { secret: 'test', baseUrl: 'http://localhost:4200' },
    })
    const t = await createTestApp({ storage })
    const files = storage.forOrganization(ORG)
    const upload = new URL(await files.putUrl('a.txt', { contentType: 'text/plain' }))
    const put = await t.request(upload.pathname, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    })
    expect(put.status).toBe(200)
    const download = new URL(await files.getUrl('a.txt'))
    const got = await t.request(download.pathname)
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('text/plain')
    expect(await got.text()).toBe('hello')
    expect((await t.request('/api/files/local/unsigned')).status).toBe(403)
    await t.close()
  })

  it('does not exist when the storage does not sign URLs', async () => {
    const t = await createTestApp()
    expect((await t.request('/api/files/local/anything')).status).toBe(404)
    await t.close()
  })
})
