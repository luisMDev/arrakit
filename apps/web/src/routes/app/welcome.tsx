import { createFileRoute } from '@tanstack/react-router'

import { onPaidPlan, welcomeSearch } from '#/lib/guards'
import { WelcomePage } from '#/components/shell/welcome-page'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/welcome')({
  validateSearch: welcomeSearch,
  beforeLoad: onPaidPlan,
  head: titled('welcome'),
  component: WelcomePage,
})
