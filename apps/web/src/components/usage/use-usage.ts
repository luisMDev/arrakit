import { useQuery } from '@tanstack/react-query'

import { tr } from '#/i18n'
import { orpc } from '#/lib/orpc'
import { useFailureToast } from '#/lib/use-failure-toast'

/** `usage.get`, with the "couldn't load" toast when it fails. */
export function useUsage() {
  const query = useQuery({ ...orpc.usage.get.queryOptions(), retry: false })
  useFailureToast(query.error, '[usage] usage.get failed', tr('settings.usageSettings.notLoaded'))
  return query
}
