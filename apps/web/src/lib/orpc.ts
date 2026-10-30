import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import type { Contract } from '@arrakit/contract'

const link = new RPCLink({
  url: () => `${window.location.origin}/api/rpc`,
  fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: 'include' }),
})

export const client: ContractRouterClient<Contract> = createORPCClient(link)

/** TanStack Query helpers: `useQuery(orpc.me.get.queryOptions())`, `orpc.x.mutationOptions()`. */
export const orpc = createTanstackQueryUtils(client)
