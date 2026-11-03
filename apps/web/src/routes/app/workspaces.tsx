import { createFileRoute } from '@tanstack/react-router'

import { WorkspacesPage } from '#/components/workspaces/workspaces-page'
import { requirePermission } from '#/lib/guards'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/workspaces')({
  beforeLoad: requirePermission({ workspace: ['read'] }),
  head: titled('workspaces'),
  component: WorkspacesPage,
})
