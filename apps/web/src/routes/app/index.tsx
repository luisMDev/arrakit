import { createFileRoute } from '@tanstack/react-router'

import { HomePage } from '#/components/shell/home-page'
import { toWorkspaceHome } from '#/lib/guards'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/')({
  beforeLoad: toWorkspaceHome,
  head: titled('home'),
  component: HomePage,
})
