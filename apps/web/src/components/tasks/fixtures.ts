import type { TaskPage, TaskView } from '@arrakit/contract'

let counter = 0

/** A queued task started by the viewer; each call has its own id. */
export function taskOf(overrides: Partial<TaskView> = {}): TaskView {
  counter += 1
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    kind: 'workspace.export',
    label: `Export ${counter}`,
    workspaceId: null,
    subject: null,
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    progress: { done: 0, total: null },
    errorCode: null,
    result: null,
    requestedById: 'user-1',
    requesterName: 'Lucía Gómez',
    requestedByYou: true,
    createdAt: '2026-11-11T09:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }
}

export const pageOf = (tasks: TaskView[], next: string | null = null): TaskPage => ({
  tasks,
  next,
})
