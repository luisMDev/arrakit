// oRPC contract shared by apps/api (implements it) and apps/web (consumes it).
// Each feature adds its procedures here as a nested router (me, organizations, billing, ...).
import { oc } from '@orpc/contract'
import { z } from 'zod'

export const pingContract = oc
  .route({ method: 'GET', path: '/ping', tags: ['system'] })
  .output(z.object({ ok: z.literal(true) }))

export const contract = {
  ping: pingContract,
}

export type Contract = typeof contract
