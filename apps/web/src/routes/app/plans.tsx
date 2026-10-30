import { createFileRoute } from '@tanstack/react-router'

import { PlansPage } from '#/components/billing/plans-page'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/plans')({
  head: titled('plans'),
  component: PlansPage,
})
