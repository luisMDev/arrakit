import { createFileRoute } from '@tanstack/react-router'

import { UnavailablePage } from '#/components/shell/unavailable-page'
import { titled } from '#/lib/page-title'

interface UnavailableSearch {
  reason?: 'forbidden'
  next?: string
}

export const Route = createFileRoute('/unavailable')({
  validateSearch: (search: Record<string, unknown>): UnavailableSearch => ({
    ...(search.reason === 'forbidden' ? { reason: 'forbidden' as const } : {}),
    ...(typeof search.next === 'string' ? { next: search.next } : {}),
  }),
  head: titled('unavailable'),
  component: function Unavailable() {
    return <UnavailablePage {...Route.useSearch()} />
  },
})
