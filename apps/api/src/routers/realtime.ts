import { signSupabaseToken } from '@arrakit/auth'
import { allows } from '@arrakit/auth/permissions'
import { taskTopics } from '@arrakit/db'

import { member } from '../orpc/base'

export const realtimeRouter = {
  access: member().realtime.access.handler(async ({ context }) => {
    const { supabase } = context.deps.env
    if (!supabase) return null
    const organizationId = context.activeOrganization.id
    const { token, expiresAt } = await signSupabaseToken(context.deps.auth, context.claims)
    return {
      url: supabase.url,
      publishableKey: supabase.publishableKey,
      token,
      expiresAt: expiresAt.toISOString(),
      topics: {
        tasks: allows(context.permissions, { task: ['read'] })
          ? taskTopics.organization(organizationId)
          : taskTopics.requester(organizationId, context.user.id),
      },
    }
  }),
}
