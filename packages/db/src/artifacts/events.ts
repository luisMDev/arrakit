import type { ArtifactFormat } from '@arrakit/plans'

export const ARTIFACT_EVENTS = {
  created: 'artifact.created',
  versionPublished: 'artifact.version_published',
  renamed: 'artifact.renamed',
  deleted: 'artifact.deleted',
} as const

/** What every artifact event carries; `workspaceId` null means an organization artifact. */
export interface ArtifactEvent {
  organizationId: string
  workspaceId: string | null
  artifactId: string
  title: string
  format: ArtifactFormat
  /** The current version once the change is made. */
  version: number
  createdBy: string | null
  /** ISO 8601. */
  occurredAt: string
}

export interface ArtifactVersionPublishedEvent extends ArtifactEvent {
  sizeBytes: number
  publishedBy: string | null
}

export interface ArtifactRenamedEvent extends ArtifactEvent {
  previousTitle: string
}

export interface ArtifactEventPayloads {
  'artifact.created': ArtifactVersionPublishedEvent
  'artifact.version_published': ArtifactVersionPublishedEvent
  'artifact.renamed': ArtifactRenamedEvent
  'artifact.deleted': ArtifactEvent
}
