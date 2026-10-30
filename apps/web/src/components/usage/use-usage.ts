import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { tr } from '#/i18n'
import { reportError, toastError } from '#/lib/api-errors'
import { orpc } from '#/lib/orpc'

/** `usage.get`, with the "couldn't load" toast when it fails. */
export function useUsage() {
  const query = useQuery({ ...orpc.usage.get.queryOptions(), retry: false })
  const { error } = query
  useEffect(() => {
    if (!error) return
    reportError('[usage] usage.get failed', error)
    toastError(tr('settings.usageSettings.notLoaded'))
  }, [error])
  return query
}
