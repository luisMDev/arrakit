import { useQuery } from '@tanstack/react-query'

import { tr } from '#/i18n'
import { useCurrentUser } from '#/lib/current-user'
import { orpc } from '#/lib/orpc'

/** `usage.get` when the person's role reads usage, with the "couldn't load" toast when it fails. */
export function useUsage() {
  const { can } = useCurrentUser()
  return useQuery({
    ...orpc.usage.get.queryOptions({ meta: { failure: tr('settings.usageSettings.notLoaded') } }),
    enabled: can({ usage: ['read'] }),
  })
}
