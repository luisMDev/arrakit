import { type ArtifactFormat, contentBytes } from '@arrakit/plans'
import { type SQL, and, desc, eq, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import {
  ARTIFACT_EVENTS,
  type ArtifactEvent,
  type ArtifactEventPayloads,
} from '../artifacts/events'
import { type Database, transaction } from '../connection'
import type { DataContext } from '../context'
import { DomainError } from '../errors'
import type { OrganizationId } from '../organization-id'
import { artifactVersions, artifacts, users, workspaces } from '../schema/index'
import { NO_SUCH_WORKSPACE } from './files'

export type ArtifactRow = typeof artifacts.$inferSelect
export type ArtifactVersionRow = typeof artifactVersions.$inferSelect

export interface ListedArtifact extends ArtifactRow {
  creatorName: string | null
}

export type ListedArtifactVersion = Omit<ArtifactVersionRow, 'content'> & {
  publisherName: string | null
}

export interface NewArtifact {
  workspaceId: string | null
  title: string
  format: ArtifactFormat
  content: string
  createdBy: string
}

export interface NewArtifactVersion {
  content: string
  publishedBy: string
}

export interface PublishedArtifact {
  artifact: ArtifactRow
  version: ArtifactVersionRow
}

const creators = alias(users, 'artifact_creators')
const publishers = alias(users, 'artifact_publishers')

export function artifactsScope(ctx: DataContext, organizationId: OrganizationId) {
  const { db } = ctx
  const inOrganization = eq(artifacts.organizationId, organizationId)
  const byId = (id: string) => and(inOrganization, eq(artifacts.id, id))
  const inScope = (workspaceId: string | null) =>
    and(
      inOrganization,
      workspaceId ? eq(artifacts.workspaceId, workspaceId) : isNull(artifacts.workspaceId),
    )
  const versionsOf = (artifactId: string) =>
    and(
      eq(artifactVersions.organizationId, organizationId),
      eq(artifactVersions.artifactId, artifactId),
    )

  const listed = (where: SQL | undefined) =>
    db
      .select({ artifact: artifacts, creatorName: creators.name })
      .from(artifacts)
      .leftJoin(creators, eq(creators.id, artifacts.createdBy))
      .where(where)
      .$dynamic()
  const withCreatorName = ({
    artifact,
    creatorName,
  }: {
    artifact: ArtifactRow
    creatorName: string | null
  }): ListedArtifact => ({ ...artifact, creatorName })

  function eventOf(artifact: ArtifactRow): ArtifactEvent {
    return {
      organizationId,
      workspaceId: artifact.workspaceId,
      artifactId: artifact.id,
      title: artifact.title,
      format: artifact.format,
      version: artifact.currentVersion,
      createdBy: artifact.createdBy,
      occurredAt: ctx.now().toISOString(),
    }
  }

  const publish = <E extends keyof ArtifactEventPayloads>(
    tx: Database,
    event: E,
    payload: ArtifactEventPayloads[E],
  ) => ctx.jobs.publish(event, payload, { tx })

  const lockedArtifact = async (tx: Database, id: string) => {
    const [row] = await tx.select().from(artifacts).where(byId(id)).for('update')
    return row
  }

  async function insertVersion(
    tx: Database,
    artifact: ArtifactRow,
    input: NewArtifactVersion,
  ): Promise<ArtifactVersionRow> {
    const [version] = await tx
      .insert(artifactVersions)
      .values({
        organizationId,
        artifactId: artifact.id,
        number: artifact.currentVersion,
        content: input.content,
        sizeBytes: contentBytes(input.content),
        publishedBy: input.publishedBy,
      })
      .returning()
    return version!
  }

  async function assertWorkspace(tx: Database, workspaceId: string | null) {
    if (!workspaceId) return
    const [found] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.organizationId, organizationId), eq(workspaces.id, workspaceId)))
    if (!found) throw new DomainError('NOT_FOUND', NO_SUCH_WORKSPACE)
  }

  return {
    /** The artifacts of one scope, most recently changed first. */
    list: (workspaceId: string | null): Promise<ListedArtifact[]> =>
      listed(inScope(workspaceId))
        .orderBy(desc(artifacts.updatedAt), desc(artifacts.id))
        .then((rows) => rows.map(withCreatorName)),

    /** Undefined when the organization has no such artifact. */
    get: async (id: string): Promise<ListedArtifact | undefined> => {
      const [row] = await listed(byId(id))
      return row && withCreatorName(row)
    },

    /** One version with its content, the current one when `number` is absent. */
    version: async (id: string, number?: number): Promise<ArtifactVersionRow | undefined> => {
      const [row] = await db
        .select({ version: artifactVersions })
        .from(artifactVersions)
        .innerJoin(artifacts, eq(artifacts.id, artifactVersions.artifactId))
        .where(and(versionsOf(id), eq(artifactVersions.number, number ?? artifacts.currentVersion)))
      return row?.version
    },

    /** Every version without its content, newest first; empty for another's artifact. */
    versions: (id: string): Promise<ListedArtifactVersion[]> =>
      db
        .select({
          id: artifactVersions.id,
          organizationId: artifactVersions.organizationId,
          artifactId: artifactVersions.artifactId,
          number: artifactVersions.number,
          sizeBytes: artifactVersions.sizeBytes,
          publishedBy: artifactVersions.publishedBy,
          createdAt: artifactVersions.createdAt,
          publisherName: publishers.name,
        })
        .from(artifactVersions)
        .leftJoin(publishers, eq(publishers.id, artifactVersions.publishedBy))
        .where(versionsOf(id))
        .orderBy(desc(artifactVersions.number)),

    /**
     * The artifact with its first version, and artifact.created, in one transaction.
     * NOT_FOUND for a workspace of another organization.
     */
    create: (input: NewArtifact): Promise<PublishedArtifact> =>
      transaction(db, async (tx) => {
        await assertWorkspace(tx, input.workspaceId)
        const [artifact] = await tx
          .insert(artifacts)
          .values({
            organizationId,
            workspaceId: input.workspaceId,
            title: input.title,
            format: input.format,
            createdBy: input.createdBy,
          })
          .returning()
        const version = await insertVersion(tx, artifact!, {
          content: input.content,
          publishedBy: input.createdBy,
        })
        await publish(tx, ARTIFACT_EVENTS.created, {
          ...eventOf(artifact!),
          sizeBytes: version.sizeBytes,
          publishedBy: version.publishedBy,
        })
        return { artifact: artifact!, version }
      }),

    /** Adds the next version and makes it current; undefined when there is no such artifact. */
    publish: (id: string, input: NewArtifactVersion): Promise<PublishedArtifact | undefined> =>
      transaction(db, async (tx) => {
        const before = await lockedArtifact(tx, id)
        if (!before) return undefined
        const [artifact] = await tx
          .update(artifacts)
          .set({ currentVersion: before.currentVersion + 1 })
          .where(byId(id))
          .returning()
        const version = await insertVersion(tx, artifact!, input)
        await publish(tx, ARTIFACT_EVENTS.versionPublished, {
          ...eventOf(artifact!),
          sizeBytes: version.sizeBytes,
          publishedBy: version.publishedBy,
        })
        return { artifact: artifact!, version }
      }),

    /** Undefined when there is no such artifact. */
    rename: (id: string, title: string): Promise<ArtifactRow | undefined> =>
      transaction(db, async (tx) => {
        const before = await lockedArtifact(tx, id)
        if (!before) return undefined
        const [row] = await tx.update(artifacts).set({ title }).where(byId(id)).returning()
        await publish(tx, ARTIFACT_EVENTS.renamed, {
          ...eventOf(row!),
          previousTitle: before.title,
        })
        return row
      }),

    /** Deletes the artifact and its versions, and publishes artifact.deleted. */
    remove: (id: string): Promise<ArtifactRow | undefined> =>
      transaction(db, async (tx) => {
        const [row] = await tx.delete(artifacts).where(byId(id)).returning()
        if (row) await publish(tx, ARTIFACT_EVENTS.deleted, eventOf(row))
        return row
      }),

    /**
     * Runs `removeWorkspace` in `tx`; when it removes the workspace, publishes artifact.deleted
     * for each of its artifacts. The rows go by cascade.
     */
    removingWorkspace: async (
      tx: Database,
      workspaceId: string,
      removeWorkspace: (tx: Database) => Promise<boolean>,
    ): Promise<boolean> => {
      const inWorkspace = await tx.select().from(artifacts).where(inScope(workspaceId))
      if (!(await removeWorkspace(tx))) return false
      for (const artifact of inWorkspace) {
        await publish(tx, ARTIFACT_EVENTS.deleted, eventOf(artifact))
      }
      return true
    },
  }
}

export type OrganizationArtifacts = ReturnType<typeof artifactsScope>
