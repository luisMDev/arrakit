import { contract } from '@arrakit/contract'
import { isContractProcedure } from '@orpc/contract'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type TestApp, createTestApp } from '../testing/app'
import { OPERATION_STATUSES, generateOpenApiDocument } from './openapi'

interface Operation {
  tags?: string[]
  operationId?: string
  requestBody?: unknown
  parameters?: unknown[]
  responses: Record<string, { content?: Record<string, { schema?: unknown }> }>
}
type Doc = { paths: Record<string, Record<string, Operation>> }

const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const

const doc = async () => (await generateOpenApiDocument()) as unknown as Doc
const statuses = (operation: Operation) => Object.keys(operation.responses).sort()

function procedurePaths(node: unknown, path: string[] = []): string[] {
  if (isContractProcedure(node)) return [path.join('.')]
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
    procedurePaths(child, [...path, key]),
  )
}

describe('the statuses the OpenAPI document lists', () => {
  it('has an entry for every contract procedure, and none for a procedure that is gone', () => {
    expect(Object.keys(OPERATION_STATUSES).sort()).toEqual(procedurePaths(contract).sort())
  })

  it('lists /health as 200 and 503 with the same body, and nothing else', async () => {
    const health = (await doc()).paths['/health']!.get!
    expect(statuses(health)).toEqual(['200', '503'])
    expect(health.responses['503']!.content).toEqual(health.responses['200']!.content)
  })

  it('lists who-am-I and organization creation by Next and by Skip with their statuses', async () => {
    const { paths } = await doc()
    expect(statuses(paths['/me']!.get!)).toEqual(['200', '401'])
    expect(statuses(paths['/organizations']!.post!)).toEqual(['201', '400', '401', '409'])
    const skip = paths['/organizations/skip']!.post!
    expect(skip.requestBody).toBeUndefined()
    expect(statuses(skip)).toEqual(['201', '401', '409'])
  })

  it("lists the owner's organization delete as 204 with no body", async () => {
    const remove = (await doc()).paths['/organizations']!.delete!
    expect(remove.requestBody).toBeUndefined()
    expect(remove.parameters ?? []).toEqual([])
    expect(statuses(remove)).toEqual(['204', '401', '403', '404', '502', '503'])
    expect(remove.responses['204']!.content).toBeUndefined()
  })

  it("lists the person's account delete and Settings > Account with their statuses", async () => {
    const { paths } = await doc()
    const remove = paths['/me']!.delete!
    expect(remove.requestBody).toBeUndefined()
    expect(statuses(remove)).toEqual(['204', '401', '409'])
    expect(remove.responses['204']!.content).toBeUndefined()
    expect(statuses(paths['/me/account']!.get!)).toEqual(['200', '401'])
    expect(statuses(paths['/me/account']!.patch!)).toEqual(['200', '400', '401'])
  })

  it('documents every void delete as 204 with no body', async () => {
    const { paths } = await doc()
    for (const path of ['/me', '/organizations', '/members/{email}', '/invitations/{id}']) {
      const remove = paths[path]!.delete!
      expect({ path, success: Object.keys(remove.responses)[0] }).toEqual({ path, success: '204' })
      expect(remove.responses['200']).toBeUndefined()
      expect(remove.responses['204']!.content).toBeUndefined()
    }
  })

  it('lists 402 only where a payment can be refused', async () => {
    const { paths } = await doc()
    const with402 = Object.entries(paths).flatMap(([path, item]) =>
      METHODS.filter((method) => item[method]?.responses['402']).map((m) => `${m} ${path}`),
    )
    expect(with402).toEqual(['post /billing/change'])
  })

  it('documents each error status with an error body', async () => {
    const { paths } = await doc()
    const unauthorized = paths['/members']!.get!.responses['401']!
    expect(unauthorized.content?.['application/json']?.schema).toBeDefined()
  })
})

describe('the REST surface answers the statuses the document lists', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  const operations = async () =>
    Object.entries((await doc()).paths)
      .filter(([path]) => path !== '/health')
      .flatMap(([path, item]) =>
        METHODS.filter((method) => item[method]).map(
          (method) => [method, path, item[method]!] as const,
        ),
      )

  const jsonHeaders = (headers: Headers | Record<string, string> = {}) => {
    const all = new Headers(headers)
    all.set('content-type', 'application/json')
    return all
  }

  const call = (method: string, path: string, headers?: Headers | Record<string, string>) =>
    t.request(`/api${path.replace(/\{[^}]+\}/g, 'x')}`, {
      method: method.toUpperCase(),
      headers: jsonHeaders(headers),
      ...(method === 'get' ? {} : { body: '{}' }),
    })

  it('answers a signed-out caller only with a documented status', async () => {
    for (const [method, path, operation] of await operations()) {
      const res = await call(method, path)
      expect({ method, path, status: res.status }).toEqual({
        method,
        path,
        status: expect.toBeOneOf(Object.keys(operation.responses).map(Number)),
      })
    }
  })

  it('answers a signed-in person with no organization only with a documented status', async () => {
    const { headers } = await t.signIn({ email: 'no-org@acme.com' })
    expect((await call('get', '/me', headers)).status).toBe(200)
    const skipped = ['delete /me', 'post /organizations', 'post /organizations/skip']
    for (const [method, path, operation] of await operations()) {
      if (skipped.includes(`${method} ${path}`)) continue
      const res = await call(method, path, headers)
      expect({ method, path, status: res.status }).toEqual({
        method,
        path,
        status: expect.toBeOneOf(Object.keys(operation.responses).map(Number)),
      })
    }
  })

  it("answers an organization's owner (Free, Stripe not set up) only with a documented status", async () => {
    const { headers } = await t.signIn({ email: 'owner@sweep.com' })
    const created = await t.request('/api/organizations/skip', {
      method: 'POST',
      headers: jsonHeaders(headers),
    })
    expect(created.status).toBe(201)
    // Deleting the organization or the account would end the sweep; their tests are above.
    const skipped = ['delete /me', 'delete /organizations']
    const seen = new Set<number>()
    for (const [method, path, operation] of await operations()) {
      if (skipped.includes(`${method} ${path}`)) continue
      const res = await call(method, path, headers)
      seen.add(res.status)
      expect({ method, path, status: res.status }).toEqual({
        method,
        path,
        status: expect.toBeOneOf(Object.keys(operation.responses).map(Number)),
      })
    }
    // The sweep reached past the guards: validation, conflicts and the missing Stripe all answered.
    expect([...seen]).toEqual(expect.arrayContaining([200, 400, 409, 503]))
  })

  it('deletes the account with 204 and an empty body', async () => {
    const { headers } = await t.signIn({ email: 'leaving@acme.com' })
    const res = await t.request('/api/me', { method: 'DELETE', headers })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect((await t.request('/api/me', { headers })).status).toBe(401)
  })

  it('creates an organization with 201 and refuses a second one with 409', async () => {
    const { headers } = await t.signIn({ email: 'founder@acme.com' })
    const skip = () =>
      t.request('/api/organizations/skip', {
        method: 'POST',
        headers: jsonHeaders(headers),
      })
    expect((await skip()).status).toBe(201)
    expect((await skip()).status).toBe(409)
  })
})
