// @vitest-environment node
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { H3, toNodeHandler } from 'nitro/h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { apiOriginFrom, apiProxyRules } from './api-proxy'

interface Received {
  url: string
  headers: IncomingHttpHeaders
}

interface H3Rules {
  routeRules: (
    rules: Record<string, unknown>,
    opts: { handlers: Record<string, unknown> },
  ) => Parameters<H3['use']>[0]
}

// h3 is a dependency of nitro, not of the web app: load the same route-rule runtime nitro uses.
async function loadH3Rules() {
  const fromNitro = createRequire(import.meta.resolve('nitro/package.json'))
  const load = (id: string) => import(pathToFileURL(fromNitro.resolve(id)).href)
  const [{ routeRules }, { proxy }] = (await Promise.all([
    load('h3/rules'),
    load('h3/rules/proxy'),
  ])) as [H3Rules, { proxy: unknown }]
  return (rules: Record<string, unknown>) => routeRules(rules, { handlers: { proxy } })
}

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  )

describe('apiProxyRules', () => {
  it('proxies the API paths to the API origin with forwarding headers', () => {
    const rule = (path: string) => ({
      proxy: {
        to: `http://api.test:3000${path}/**`,
        xfwd: true,
        filterHeaders: ['x-forwarded-for'],
      },
    })
    expect(apiProxyRules('http://api.test:3000/')).toEqual({
      '/api/**': rule('/api'),
      '/.well-known/oauth-authorization-server/**': rule('/.well-known/oauth-authorization-server'),
      '/.well-known/oauth-protected-resource/**': rule('/.well-known/oauth-protected-resource'),
    })
  })

  it('defaults the API origin to localhost:3000', () => {
    expect(apiOriginFrom(undefined)).toBe('http://localhost:3000')
    expect(apiOriginFrom('https://api.example.com/')).toBe('https://api.example.com')
  })
})

describe('the web server proxy in front of the API', () => {
  const received: Received[] = []
  const api = createServer((req, res) => {
    received.push({ url: req.url ?? '', headers: req.headers })
    if (req.url?.startsWith('/api/auth/callback')) {
      res.writeHead(302, { location: 'https://accounts.example.com/consent' }).end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
  })
  const web = { server: undefined as Server | undefined, origin: '' }

  beforeAll(async () => {
    const apiOrigin = await listen(api)
    const app = new H3().use((await loadH3Rules())(apiProxyRules(apiOrigin)))
    web.server = createServer(toNodeHandler(app))
    web.origin = await listen(web.server)
  })

  afterAll(() => {
    api.close()
    web.server?.close()
  })

  const last = () => received.at(-1)!

  it('forwards the client IP, the cookie and the Origin to the API', async () => {
    const res = await fetch(`${web.origin}/api/rpc/me/get?x=1`, {
      method: 'POST',
      headers: {
        cookie: 'better-auth.session_token=abc',
        origin: 'http://localhost:4200',
        'content-type': 'application/json',
      },
      body: '{}',
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const { url, headers } = last()
    expect(url).toBe('/api/rpc/me/get?x=1')
    expect(headers['x-forwarded-for']).toMatch(/127\.0\.0\.1/)
    expect(headers['x-forwarded-host']).toBe(new URL(web.origin).host)
    expect(headers['x-forwarded-proto']).toBe('http')
    expect(headers.cookie).toBe('better-auth.session_token=abc')
    expect(headers.origin).toBe('http://localhost:4200')
  })

  it('sends the API exactly one client IP, even when the client sends its own chain', async () => {
    // Better Auth (no trustedProxies) ignores a multi-hop X-Forwarded-For, so a spoofed or
    // upstream chain must not reach the API appended to.
    await fetch(`${web.origin}/api/health`, {
      headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.1' },
    })
    expect(last().headers['x-forwarded-for']).toMatch(/^(::ffff:)?127\.0\.0\.1$/)
  })

  it('passes x-real-ip from a platform edge through to the API', async () => {
    await fetch(`${web.origin}/api/health`, { headers: { 'x-real-ip': '203.0.113.9' } })
    expect(last().headers['x-real-ip']).toBe('203.0.113.9')
  })

  it('hands redirects back to the browser instead of following them', async () => {
    const res = await fetch(`${web.origin}/api/auth/callback/google?code=1`, {
      redirect: 'manual',
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://accounts.example.com/consent')
    expect(received.filter((r) => r.url.startsWith('/api/auth/callback'))).toHaveLength(1)
  })

  it('proxies the OAuth metadata under /.well-known with forwarding headers', async () => {
    const res = await fetch(`${web.origin}/.well-known/oauth-protected-resource/api/mcp`)
    expect(res.status).toBe(200)
    expect(last().url).toBe('/.well-known/oauth-protected-resource/api/mcp')
    expect(last().headers['x-forwarded-for']).toMatch(/127\.0\.0\.1/)
  })
})
