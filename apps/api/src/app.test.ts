import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import type { Contract } from '@arrakit/contract'
import { describe, expect, it } from 'vitest'

import { createApp } from './app'

describe('api app', () => {
  const app = createApp()

  it('answers /health', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
  })

  it('serves oRPC procedures under /api/rpc', async () => {
    const link = new RPCLink({
      url: 'http://localhost/api/rpc',
      fetch: async (request) => app.fetch(request as Request),
    })
    const client: ContractRouterClient<Contract> = createORPCClient(link)
    await expect(client.ping()).resolves.toEqual({ ok: true })
  })

  it('serves the OpenAPI document', async () => {
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as { openapi: string }
    expect(doc.openapi).toMatch(/^3\./)
  })

  it('returns 404 for unknown routes', async () => {
    expect((await app.request('/nope')).status).toBe(404)
  })
})
