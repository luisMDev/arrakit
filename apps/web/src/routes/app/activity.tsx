import { createFileRoute } from '@tanstack/react-router'

import { ActivityPage } from '#/components/activity/activity-page'
import { activitySearch } from '#/components/activity/activity-search'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/activity')({
  validateSearch: activitySearch,
  head: titled('activity'),
  component: function Activity() {
    return <ActivityPage tab={Route.useSearch().tab} />
  },
})
