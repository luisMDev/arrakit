import { createFileRoute } from '@tanstack/react-router'

import { ArtifactPage } from '#/components/artifacts/artifact-page'
import { requirePermission } from '#/lib/guards'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/workspaces_/$workspaceId_/artifacts_/$artifactId')({
  beforeLoad: requirePermission({ workspace: ['read'], artifact: ['read'] }),
  head: titled('artifact'),
  component: function ArtifactRoute() {
    const { workspaceId, artifactId } = Route.useParams()
    return <ArtifactPage workspaceId={workspaceId} artifactId={artifactId} />
  },
})
