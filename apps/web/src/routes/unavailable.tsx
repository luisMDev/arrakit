import { createFileRoute } from '@tanstack/react-router'

import { UnavailablePage, unavailableSearch } from '#/components/shell/unavailable-page'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/unavailable')({
  validateSearch: unavailableSearch,
  head: titled('unavailable'),
  component: function Unavailable() {
    return <UnavailablePage {...Route.useSearch()} />
  },
})
