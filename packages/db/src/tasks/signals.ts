/** The Realtime broadcast event a task change is signalled with. */
export const TASK_SIGNAL_EVENT = 'task.changed'

/** What a task signal carries: read the task to see how it is now. */
export interface TaskSignal {
  taskId: string
}

/** The private Realtime topics task signals go to; `realtime.messages` policies match these shapes. */
export const taskTopics = {
  organization: (organizationId: string) => `org:${organizationId}:tasks`,
  requester: (organizationId: string, userId: string) =>
    `org:${organizationId}:user:${userId}:tasks`,
}
