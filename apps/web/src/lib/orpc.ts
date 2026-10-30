import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import type { Contract } from '@arrakit/contract'

import { apiOriginFrom } from './api-proxy'

// Typed oRPC client for @arrakit/contract. In the browser it calls the same origin
// (/api is proxied to the API); during SSR it calls API_ORIGIN directly.
function rpcUrl(): string {
  if (typeof window !== 'undefined') return `${window.location.origin}/api/rpc`
  return `${apiOriginFrom(process.env.API_ORIGIN)}/api/rpc`
}

const link = new RPCLink({
  url: rpcUrl,
  fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: 'include' }),
})

export const client: ContractRouterClient<Contract> = createORPCClient(link)

/** TanStack Query helpers: `useQuery(orpc.me.get.queryOptions())`, `orpc.x.mutationOptions()`. */
export const orpc = createTanstackQueryUtils(client)
