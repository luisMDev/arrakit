import { createFileRoute } from '@tanstack/react-router'

import { HomePage } from '#/components/shell/home-page'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/')({
  head: titled('home'),
  component: HomePage,
})
