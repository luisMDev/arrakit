import { TASK_EVENTS, type TaskEventPayloads } from '@arrakit/db'
import { z } from 'zod'

import { defineEventDomain } from '../events/domain'

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

/** Published for a task of any kind: a subscriber checks `payload.kind` to react to one. */
export const taskEvents = defineEventDomain<TaskEventPayloads>()({
  schemas: {
    [TASK_EVENTS.succeeded]: taskEventSchema,
    [TASK_EVENTS.failed]: taskEventSchema.extend({ errorCode: z.string() }),
  },
  logFields: ({ organizationId, taskId }) => ({ organizationId, taskId }),
})
