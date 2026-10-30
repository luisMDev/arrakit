// @vitest-environment node
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { H3, toNodeHandler } from 'nitro/h3'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { apiProxiedPaths } from '../lib/api-proxy'
import apiProxyHandler, { apiTargetOf, clientIpOf } from './api-proxy-handler'

interface Received {
  url: string
  method: string
  headers: IncomingHttpHeaders
  body: string
}

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  )

/** A fake API that records every request and answers with its own name. */
function fakeApi(name: string, received: Received[]) {
  return createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      received.push({
        url: req.url ?? '',
        method: req.method ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      })
      if (req.url?.startsWith('/api/auth/callback')) {
        res.writeHead(302, { location: 'https://accounts.example.com/consent' }).end()
        return
      }
      res
        .writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': ['a=1; Path=/; HttpOnly', 'b=2; Path=/'],
        })
        .end(JSON.stringify({ api: name }))
    })
  })
}

describe('clientIpOf', () => {
  it('prefers cf-connecting-ip over the TCP peer', () => {
    expect(clientIpOf(new Headers({ 'cf-connecting-ip': ' 203.0.113.9 ' }), '10.0.0.1')).toBe(
      '203.0.113.9',
    )
  })

  it('falls back to the TCP peer when the header is absent or blank', () => {
    expect(clientIpOf(new Headers(), '10.0.0.1')).toBe('10.0.0.1')
    expect(clientIpOf(new Headers({ 'cf-connecting-ip': ' ' }), '10.0.0.1')).toBe('10.0.0.1')
    expect(clientIpOf(new Headers(), undefined)).toBeUndefined()
  })
})

describe('apiTargetOf', () => {
  it('keeps path and query and defaults the origin to localhost:3000', () => {
    const url = new URL('http://web.test/api/rpc/me/get?x=1&y=2')
    expect(apiTargetOf(url, 'https://api.example.com/')).toBe(
      'https://api.example.com/api/rpc/me/get?x=1&y=2',
    )
    expect(apiTargetOf(url, undefined)).toBe('http://localhost:3000/api/rpc/me/get?x=1&y=2')
  })
})

describe('the runtime web proxy in front of the API', () => {
  const received: Received[] = []
  const apiA = fakeApi('a', received)
  const apiB = fakeApi('b', received)
  const origins = { a: '', b: '' }
  const web = { server: undefined as Server | undefined, origin: '' }
  const savedOrigin = process.env.API_ORIGIN

  beforeAll(async () => {
    origins.a = await listen(apiA)
    origins.b = await listen(apiB)
    // Registered the way vite.config.ts registers the Nitro handler: one route per API path.
    const app = new H3()
    for (const path of apiProxiedPaths) app.all(`${path}/**`, apiProxyHandler)
    web.server = createServer(toNodeHandler(app))
    web.origin = await listen(web.server)
    process.env.API_ORIGIN = origins.a
  })

  afterEach(() => {
    process.env.API_ORIGIN = origins.a
  })

  afterAll(() => {
    apiA.close()
    apiB.close()
    web.server?.close()
    if (savedOrigin === undefined) delete process.env.API_ORIGIN
    else process.env.API_ORIGIN = savedOrigin
  })

  const last = () => received.at(-1)!

  it('reads API_ORIGIN on every request, not once at build time', async () => {
    expect(await (await fetch(`${web.origin}/api/health`)).json()).toEqual({ api: 'a' })
    process.env.API_ORIGIN = `${origins.b}/`
    expect(await (await fetch(`${web.origin}/api/health`)).json()).toEqual({ api: 'b' })
  })

  it('keeps path, query, method, body, cookie and Origin, and sets the forwarding headers', async () => {
    const res = await fetch(`${web.origin}/api/rpc/me/get?x=1`, {
      method: 'POST',
      headers: {
        cookie: 'better-auth.session_token=abc',
        origin: 'http://localhost:4200',
        'content-type': 'application/json',
      },
      body: '{"hello":"world"}',
    })

    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/; HttpOnly', 'b=2; Path=/'])
    const { url, method, headers, body } = last()
    expect(url).toBe('/api/rpc/me/get?x=1')
    expect(method).toBe('POST')
    expect(body).toBe('{"hello":"world"}')
    expect(headers['x-forwarded-for']).toMatch(/^(::ffff:)?127\.0\.0\.1$/)
    expect(headers['x-forwarded-host']).toBe(new URL(web.origin).host)
    expect(headers['x-forwarded-proto']).toBe('http')
    expect(headers.cookie).toBe('better-auth.session_token=abc')
    expect(headers.origin).toBe('http://localhost:4200')
  })

  it('maps cf-connecting-ip to x-forwarded-for when present', async () => {
    await fetch(`${web.origin}/api/health`, {
      headers: { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' },
    })
    expect(last().headers['x-forwarded-for']).toBe('203.0.113.9')
  })

  it('sends the API exactly one client IP, even when the client sends its own chain', async () => {
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
    const before = received.length
    const res = await fetch(`${web.origin}/api/auth/callback/google?code=1`, {
      redirect: 'manual',
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://accounts.example.com/consent')
    expect(received.length - before).toBe(1)
  })

  it('proxies the OAuth metadata under /.well-known', async () => {
    const res = await fetch(`${web.origin}/.well-known/oauth-authorization-server`)
    expect(res.status).toBe(200)
    expect(last().url).toBe('/.well-known/oauth-authorization-server')
    await fetch(`${web.origin}/.well-known/oauth-protected-resource/api/mcp`)
    expect(last().url).toBe('/.well-known/oauth-protected-resource/api/mcp')
  })

  it('answers 502 when the API is unreachable', async () => {
    process.env.API_ORIGIN = 'http://127.0.0.1:1'
    const res = await fetch(`${web.origin}/api/health`)
    expect(res.status).toBe(502)
  })
})
