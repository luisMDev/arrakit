import type { Me } from '@arrakit/contract'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { orpc } from '#/lib/orpc'

export function useCurrentUser() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const options = orpc.me.get.queryOptions()
  const { data } = useQuery(options)
  const user: Me | null = data ?? null
  const role = user?.role ?? null
  return {
    user,
    role,
    isAdmin: role === 'owner' || role === 'admin',
    isOwner: role === 'owner',
    planLabel: user?.plan ? t(`pricing.plan.${user.plan}`) : '',
    reload: () => queryClient.invalidateQueries({ queryKey: options.queryKey }),
    patch: (fn: (me: Me) => Me) =>
      queryClient.setQueryData<Me>(options.queryKey, (me) => (me ? fn(me) : me)),
    signedOut: () => queryClient.removeQueries({ queryKey: options.queryKey }),
  }
}
