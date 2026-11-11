import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceActivityPage } from '#/components/workspaces/workspace-activity-page'
import { requirePermission } from '#/lib/guards'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/workspaces_/$workspaceId_/activity')({
  beforeLoad: requirePermission({ workspace: ['read'] }),
  head: titled('activity'),
  component: function WorkspaceActivityRoute() {
    const { workspaceId } = Route.useParams()
    return <WorkspaceActivityPage workspaceId={workspaceId} />
  },
})
