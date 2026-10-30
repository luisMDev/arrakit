import { contract } from '@arrakit/contract'
import { ORPCError, implement } from '@orpc/server'

import { type BaseContext, type MemberLevel, requireMember, requireSession } from './context'

export const pub = implement(contract).$context<BaseContext>()
export const authed = pub.use(requireSession)
export const member = (level: MemberLevel) => authed.use(requireMember(level))

/** Stub body for procedures a feature has not implemented yet. */
export function notImplemented(procedure: string): never {
  throw new ORPCError('NOT_IMPLEMENTED', { message: `${procedure} is not implemented yet.` })
}
