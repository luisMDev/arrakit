import type { Permissions } from '@arrakit/auth/permissions'
import { contract } from '@arrakit/contract'
import { implement } from '@orpc/server'

import {
  type BaseContext,
  reportErrors,
  requireLiveSession,
  requireMember,
  requireSession,
} from './context'

export const pub = implement(contract).$context<BaseContext>().use(reportErrors)
export const authed = pub.use(requireSession)
export const authedLive = pub.use(requireLiveSession)
export const member = (wanted?: Permissions) => authed.use(requireMember(wanted))
