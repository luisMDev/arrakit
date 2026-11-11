import { TASK_EVENTS, type TaskEventName } from '@arrakit/db'
import { z } from 'zod'

const taskEventSchema = z.object({
  organizationId: z.guid(),
  workspaceId: z.guid().nullable(),
  taskId: z.guid(),
  kind: z.string(),
  subjectType: z.string().nullable(),
  subjectId: z.string().nullable(),
  requestedBy: z.string().nullable(),
  occurredAt: z.iso.datetime(),
})

export const TASK_EVENT_SCHEMAS = {
  [TASK_EVENTS.succeeded]: taskEventSchema,
  [TASK_EVENTS.failed]: taskEventSchema.extend({ errorCode: z.string() }),
} satisfies Record<TaskEventName, z.ZodType<object>>
