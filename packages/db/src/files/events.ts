export const FILE_EVENTS = {
  uploaded: 'file.uploaded',
  renamed: 'file.renamed',
  deleted: 'file.deleted',
} as const

export type FileEventName = (typeof FILE_EVENTS)[keyof typeof FILE_EVENTS]

/** What every file event carries; `workspaceId` null means an organization file. */
export interface FileEvent {
  organizationId: string
  workspaceId: string | null
  fileId: string
  name: string
  contentType: string
  sizeBytes: number
  uploadedBy: string | null
  /** ISO 8601. */
  occurredAt: string
}

export interface FileRenamedEvent extends FileEvent {
  previousName: string
}

export interface FileEventPayloads {
  'file.uploaded': FileEvent
  'file.renamed': FileRenamedEvent
  'file.deleted': FileEvent
}
