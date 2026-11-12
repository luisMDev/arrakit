import { storageGbFor } from '@arrakit/plans'
import { type SQL, and, asc, eq, isNull, lt, sql } from 'drizzle-orm'

import type { Database } from '../connection'
import type { ScopeContext } from '../context'
import { DomainError, refusingDuplicates } from '../errors'
import { FILE_EVENTS, type FileEvent, type FileEventPayloads } from '../files/events'
import { STORAGE_PURGE_QUEUE } from '../jobs/types'
import type { OrganizationId } from '../organization-id'
import { files, users, workspaces } from '../schema/index'
import type { OrganizationUsage } from './usage'

export type FileRow = typeof files.$inferSelect

export interface ListedFile extends FileRow {
  uploaderName: string | null
}

export interface NewFile {
  workspaceId: string | null
  name: string
  contentType: string
  sizeBytes: number
  uploadedBy: string
}

/** Where a file's bytes live, relative to the organization prefix. */
export const objectPathOf = (file: Pick<FileRow, 'id' | 'workspaceId'>): string =>
  file.workspaceId ? `${workspaceFolderOf(file.workspaceId)}files/${file.id}` : `files/${file.id}`

/** The folder holding every object of a workspace. */
export const workspaceFolderOf = (workspaceId: string): string => `workspaces/${workspaceId}/`

const nameTaken = (name: string) =>
  new DomainError('CONFLICT', `A file named ${name} already exists here.`)

export const NO_SUCH_WORKSPACE = 'No such workspace in your organization.'

export function filesScope(
  ctx: ScopeContext,
  organizationId: OrganizationId,
  usage: OrganizationUsage,
) {
  const inOrganization = eq(files.organizationId, organizationId)
  const byId = (id: string) => and(inOrganization, eq(files.id, id))
  const inScope = (workspaceId: string | null) =>
    and(
      inOrganization,
      workspaceId ? eq(files.workspaceId, workspaceId) : isNull(files.workspaceId),
    )
  const sameName = (workspaceId: string | null, name: string) =>
    and(
      inScope(workspaceId),
      eq(files.status, 'ready'),
      eq(sql`lower(${files.name})`, name.toLowerCase()),
    )

  const listed = (tx: Database, where: SQL | undefined) =>
    tx
      .select({ file: files, uploaderName: users.name })
      .from(files)
      .leftJoin(users, eq(users.id, files.uploadedBy))
      .where(where)
      .$dynamic()
  const withUploaderName = ({
    file,
    uploaderName,
  }: {
    file: FileRow
    uploaderName: string | null
  }) => ({ ...file, uploaderName })

  async function storedLevel(tx: Database): Promise<number> {
    const [row] = await tx
      .select({ bytes: sql<string>`coalesce(sum(${files.sizeBytes}), 0)` })
      .from(files)
      .where(inOrganization)
    return storageGbFor(Number(row!.bytes))
  }

  function eventOf(file: FileRow): FileEvent {
    return {
      organizationId,
      workspaceId: file.workspaceId,
      fileId: file.id,
      name: file.name,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      uploadedBy: file.uploadedBy,
      occurredAt: ctx.now().toISOString(),
    }
  }

  const publish = <E extends keyof FileEventPayloads>(
    tx: Database,
    event: E,
    payload: FileEventPayloads[E],
  ) => ctx.jobs.publish(event, payload, { tx })

  /** Changes the stored bytes and refreshes the storage_gb level in one locked transaction. */
  const changingStorage = <R>(work: (tx: Database) => Promise<R>): Promise<R> =>
    usage.setLevelWith('storage_gb', async (tx) => {
      const result = await work(tx)
      return { level: await storedLevel(tx), result }
    })

  async function assertWorkspace(tx: Database, workspaceId: string | null) {
    if (!workspaceId) return
    const [found] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.organizationId, organizationId), eq(workspaces.id, workspaceId)))
    if (!found) throw new DomainError('NOT_FOUND', NO_SUCH_WORKSPACE)
  }

  return {
    /** Uploaded (ready) files of one scope, by name. */
    list: (workspaceId: string | null): Promise<ListedFile[]> =>
      ctx.scoped(async (tx) => {
        const rows = await listed(tx, and(inScope(workspaceId), eq(files.status, 'ready'))).orderBy(
          asc(sql`lower(${files.name})`),
          asc(files.id),
        )
        return rows.map(withUploaderName)
      }),

    /** Any status; undefined when the organization has no such file. */
    get: (id: string): Promise<ListedFile | undefined> =>
      ctx.scoped(async (tx) => {
        const [row] = await listed(tx, byId(id))
        return row && withUploaderName(row)
      }),

    /**
     * A pending file whose bytes count against storage_gb until it is completed or expired.
     * NOT_FOUND for a workspace of another organization, CONFLICT for a name in use,
     * PAYMENT_REQUIRED when it does not fit.
     */
    reserve: (input: NewFile): Promise<FileRow> =>
      changingStorage(async (tx) => {
        await assertWorkspace(tx, input.workspaceId)
        const [taken] = await tx
          .select({ id: files.id })
          .from(files)
          .where(sameName(input.workspaceId, input.name))
        if (taken) throw nameTaken(input.name)
        const [row] = await tx
          .insert(files)
          .values({ ...input, organizationId, status: 'pending' })
          .returning()
        return row!
      }),

    /** Marks a pending file uploaded and publishes file.uploaded; undefined when not pending. */
    complete: (id: string): Promise<FileRow | undefined> =>
      refusingDuplicates(
        () =>
          ctx.scoped(async (tx) => {
            const [row] = await tx
              .update(files)
              .set({ status: 'ready' })
              .where(and(byId(id), eq(files.status, 'pending')))
              .returning()
            if (row) await publish(tx, FILE_EVENTS.uploaded, eventOf(row))
            return row
          }),
        () => nameTaken('this name'),
      ),

    /** Undefined when there is no such uploaded file; CONFLICT on a name in use. */
    rename: (id: string, name: string): Promise<FileRow | undefined> =>
      refusingDuplicates(
        () =>
          ctx.scoped(async (tx) => {
            const [before] = await tx
              .select()
              .from(files)
              .where(and(byId(id), eq(files.status, 'ready')))
              .for('update')
            if (!before) return undefined
            const [row] = await tx.update(files).set({ name }).where(byId(id)).returning()
            await publish(tx, FILE_EVENTS.renamed, { ...eventOf(row!), previousName: before.name })
            return row
          }),
        () => nameTaken(name),
      ),

    /** Deletes the row (any status); publishes file.deleted for an uploaded one. */
    remove: (id: string): Promise<FileRow | undefined> =>
      changingStorage(async (tx) => {
        const [row] = await tx.delete(files).where(byId(id)).returning()
        if (row?.status === 'ready') await publish(tx, FILE_EVENTS.deleted, eventOf(row))
        return row
      }),

    /** Deletes pending files created before `before`; their objects are the caller's to remove. */
    expirePending: (before: Date): Promise<FileRow[]> =>
      changingStorage((tx) =>
        tx
          .delete(files)
          .where(and(inOrganization, eq(files.status, 'pending'), lt(files.createdAt, before)))
          .returning(),
      ),

    /**
     * Runs `removeWorkspace`; when it removes the workspace, publishes file.deleted for each of its
     * uploaded files, frees their storage and queues the purge of its objects. The rows go by
     * cascade.
     */
    removingWorkspace: (
      workspaceId: string,
      removeWorkspace: (tx: Database) => Promise<boolean>,
    ): Promise<boolean> =>
      changingStorage(async (tx) => {
        const uploaded = await tx
          .select()
          .from(files)
          .where(and(inScope(workspaceId), eq(files.status, 'ready')))
        if (!(await removeWorkspace(tx))) return false
        for (const file of uploaded) await publish(tx, FILE_EVENTS.deleted, eventOf(file))
        const folder = workspaceFolderOf(workspaceId)
        await ctx.jobs.send(STORAGE_PURGE_QUEUE, { organizationId, folder }, { tx })
        return true
      }),
  }
}

export type OrganizationFiles = ReturnType<typeof filesScope>
