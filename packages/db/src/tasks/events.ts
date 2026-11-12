export const TASK_EVENTS = {
  succeeded: 'task.succeeded',
  failed: 'task.failed',
} as const

/** What every task event carries; `workspaceId` null means organization-wide work. */
export interface TaskEvent {
  organizationId: string
  workspaceId: string | null
  taskId: string
  kind: string
  subjectType: string | null
  subjectId: string | null
  requestedBy: string | null
  /** ISO 8601. */
  occurredAt: string
}

export interface TaskFailedEvent extends TaskEvent {
  errorCode: string
}

export interface TaskEventPayloads {
  'task.succeeded': TaskEvent
  'task.failed': TaskFailedEvent
}
