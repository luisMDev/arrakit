import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceTasksPage } from '#/components/workspaces/workspace-tasks-page'
import { requirePermission } from '#/lib/guards'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/workspaces_/$workspaceId_/tasks')({
  beforeLoad: requirePermission({ workspace: ['read'] }),
  head: titled('tasks'),
  component: function WorkspaceTasksRoute() {
    const { workspaceId } = Route.useParams()
    return <WorkspaceTasksPage workspaceId={workspaceId} />
  },
})
