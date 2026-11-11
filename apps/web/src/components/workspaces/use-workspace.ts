import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { orpc } from '#/lib/orpc'

/** One workspace of the organization. */
export function useWorkspace(workspaceId: string) {
  const { t } = useTranslation()
  return useQuery({
    ...orpc.workspaces.get.queryOptions({ input: { id: workspaceId } }),
    meta: { failure: t('workspaces.notLoadedOne') },
  })
}
