import { type Permissions, allows } from '@arrakit/auth/permissions'
import type { Artifact, ArtifactContent, ArtifactVersion } from '@arrakit/contract'
import {
  type ArtifactRow,
  DomainError,
  NO_SUCH_WORKSPACE,
  type OrganizationScope,
} from '@arrakit/db'
import { type ArtifactFormat, type Plan, artifactPolicyFor, fitsArtifact } from '@arrakit/plans'

import { dayOf } from '../day'
import { NOT_PERMITTED } from '../orpc/context'

export const NO_SUCH_ARTIFACT = 'No such artifact in your organization.'
export const NO_SUCH_VERSION = 'No such version of this artifact.'

/** Who acts on artifacts, in which organization; `plan` is the organization's. */
export interface ArtifactActor {
  userId: string
  permissions: Permissions
  plan: string
  scope: OrganizationScope
}

type ViewedRow = ArtifactRow & { creatorName?: string | null }

const artifactView = (row: ViewedRow, viewerId: string): Artifact => ({
  id: row.id,
  workspaceId: row.workspaceId,
  title: row.title,
  format: row.format,
  currentVersion: row.currentVersion,
  createdById: row.createdBy,
  creatorName: row.creatorName ?? null,
  createdByYou: row.createdBy === viewerId,
  createdOn: dayOf(row.createdAt),
  updatedAt: row.updatedAt.toISOString(),
})

const forbidden = () => new DomainError('FORBIDDEN', NOT_PERMITTED)
const noSuchArtifact = () => new DomainError('NOT_FOUND', NO_SUCH_ARTIFACT)

export function artifactService(actor: ArtifactActor) {
  const { scope, permissions, userId } = actor
  const policy = artifactPolicyFor(actor.plan as Plan)
  const view = (row: ViewedRow) => artifactView(row, userId)

  const mayReadWorkspaces = (workspaceId: string | null) => {
    if (workspaceId && !allows(permissions, { workspace: ['read'] })) throw forbidden()
  }

  function assertFits(content: string) {
    if (fitsArtifact(content, policy)) return
    const megabytes = Math.floor(policy.maxBytes / 1_000_000)
    throw new DomainError('BAD_REQUEST', `The content is larger than the ${megabytes} MB limit.`)
  }

  async function readable(id: string) {
    const row = await scope.artifacts.get(id)
    if (!row) throw noSuchArtifact()
    mayReadWorkspaces(row.workspaceId)
    return row
  }

  /** The creator may always change their own artifact; others need `action`. */
  async function changeable(id: string, action: 'update' | 'delete') {
    const row = await readable(id)
    if (row.createdBy !== userId && !allows(permissions, { artifact: [action] })) throw forbidden()
    return row
  }

  return {
    async list(workspaceId: string | null): Promise<Artifact[]> {
      mayReadWorkspaces(workspaceId)
      if (workspaceId && !(await scope.workspaces.get(workspaceId))) {
        throw new DomainError('NOT_FOUND', NO_SUCH_WORKSPACE)
      }
      return (await scope.artifacts.list(workspaceId)).map(view)
    },

    get: async (id: string): Promise<Artifact> => view(await readable(id)),

    async versions(id: string): Promise<ArtifactVersion[]> {
      await readable(id)
      return (await scope.artifacts.versions(id)).map((version) => ({
        number: version.number,
        sizeBytes: version.sizeBytes,
        publishedById: version.publishedBy,
        publisherName: version.publisherName,
        publishedAt: version.createdAt.toISOString(),
      }))
    },

    async content(id: string, number?: number): Promise<ArtifactContent> {
      const row = await readable(id)
      const version = await scope.artifacts.version(id, number)
      if (!version) throw new DomainError('NOT_FOUND', NO_SUCH_VERSION)
      return {
        artifactId: id,
        version: version.number,
        format: row.format,
        content: version.content,
      }
    },

    async create(input: {
      workspaceId: string | null
      title: string
      format: ArtifactFormat
      content: string
    }): Promise<Artifact> {
      mayReadWorkspaces(input.workspaceId)
      assertFits(input.content)
      const { artifact } = await scope.artifacts.create({ ...input, createdBy: userId })
      return view((await scope.artifacts.get(artifact.id))!)
    },

    async publish(id: string, content: string): Promise<Artifact> {
      const row = await changeable(id, 'update')
      assertFits(content)
      const published = await scope.artifacts.publish(id, { content, publishedBy: userId })
      if (!published) throw noSuchArtifact()
      return view({ ...published.artifact, creatorName: row.creatorName })
    },

    async rename(id: string, title: string): Promise<Artifact> {
      const row = await changeable(id, 'update')
      const renamed = await scope.artifacts.rename(id, title)
      if (!renamed) throw noSuchArtifact()
      return view({ ...renamed, creatorName: row.creatorName })
    },

    async remove(id: string): Promise<void> {
      await changeable(id, 'delete')
      if (!(await scope.artifacts.remove(id))) throw noSuchArtifact()
    },
  }
}
