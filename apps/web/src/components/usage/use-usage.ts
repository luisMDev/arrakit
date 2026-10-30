import { useQuery } from '@tanstack/react-query'

import { tr } from '#/i18n'
import { orpc } from '#/lib/orpc'

/** `usage.get`, with the "couldn't load" toast when it fails. */
export function useUsage() {
  return useQuery(
    orpc.usage.get.queryOptions({ meta: { failure: tr('settings.usageSettings.notLoaded') } }),
  )
}
