import { createFileRoute } from '@tanstack/react-router'

import { WorkspacePage } from '#/components/workspaces/workspace-page'
import { requirePermission } from '#/lib/guards'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/workspaces_/$workspaceId')({
  beforeLoad: requirePermission({ workspace: ['read'] }),
  head: titled('workspace'),
  component: function WorkspaceRoute() {
    const { workspaceId } = Route.useParams()
    return <WorkspacePage workspaceId={workspaceId} />
  },
})
