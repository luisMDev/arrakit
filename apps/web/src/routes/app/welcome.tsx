import { createFileRoute } from '@tanstack/react-router'

import { onPaidPlan } from '#/components/shell/on-paid-plan'
import { WelcomePage } from '#/components/shell/welcome-page'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/welcome')({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } =>
    typeof search.session_id === 'string' ? { session_id: search.session_id } : {},
  beforeLoad: onPaidPlan,
  head: titled('welcome'),
  component: WelcomePage,
})
