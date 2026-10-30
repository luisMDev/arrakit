import { contract } from '@arrakit/contract'
import { implement } from '@orpc/server'

import { type BaseContext, type MemberLevel, requireMember, requireSession } from './context'

export const pub = implement(contract).$context<BaseContext>()
export const authed = pub.use(requireSession)
export const member = (level: MemberLevel) => authed.use(requireMember(level))
