import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceArtifactsPage } from '#/components/workspaces/workspace-artifacts-page'
import { requirePermission } from '#/lib/guards'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/workspaces_/$workspaceId_/artifacts')({
  beforeLoad: requirePermission({ workspace: ['read'], artifact: ['read'] }),
  head: titled('artifacts'),
  component: function WorkspaceArtifactsRoute() {
    const { workspaceId } = Route.useParams()
    return <WorkspaceArtifactsPage workspaceId={workspaceId} />
  },
})
