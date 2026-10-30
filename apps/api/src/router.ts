import { implement } from '@orpc/server'
import { contract } from '@arrakit/contract'

// oRPC router implementing @arrakit/contract. Each feature adds its procedures here.
const os = implement(contract)

export const router = os.router({
  ping: os.ping.handler(() => ({ ok: true as const })),
})

export type Router = typeof router
