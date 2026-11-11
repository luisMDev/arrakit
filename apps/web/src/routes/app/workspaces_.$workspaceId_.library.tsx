import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceLibraryPage } from '#/components/workspaces/workspace-library-page'
import { requirePermission } from '#/lib/guards'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/workspaces_/$workspaceId_/library')({
  beforeLoad: requirePermission({ workspace: ['read'], file: ['read'] }),
  head: titled('library'),
  component: function WorkspaceLibraryRoute() {
    const { workspaceId } = Route.useParams()
    return <WorkspaceLibraryPage workspaceId={workspaceId} />
  },
})
