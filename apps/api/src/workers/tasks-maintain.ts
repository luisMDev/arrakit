import { WORKER_RETRY_POLICY } from '@arrakit/db'
import { z } from 'zod'

import { defineJob } from './job'
import { HEARTBEAT_INTERVAL_MS, TASK_ERRORS } from './tracked-job'

/** A running task with no heartbeat for this long has lost its worker. */
export const STALLED_RUNNING_MS = 10 * HEARTBEAT_INTERVAL_MS
/** A queued task no worker has picked up for this long will not be. */
export const STALLED_QUEUED_MS = 24 * 60 * 60_000
export const TASK_RETENTION_DAYS = 30

/** Fails the tasks no worker moves any more, then removes those finished long ago. */
export const tasksMaintain = defineJob({
  name: 'tasks-maintain',
  schema: z.object({}),
  policy: WORKER_RETRY_POLICY,
  schedule: { cron: '*/15 * * * *', data: {} },
  async handler(_payload, { data, log }) {
    const now = Date.now()
    const stalled = await data.stalledTasks({
      runningBefore: new Date(now - STALLED_RUNNING_MS),
      queuedBefore: new Date(now - STALLED_QUEUED_MS),
    })
    for (const { organizationId, id } of stalled) {
      await data.asSystem(organizationId).tasks.fail(id, TASK_ERRORS.stalled)
    }
    const removed = await data.removeFinishedTasks(
      new Date(now - TASK_RETENTION_DAYS * 24 * 60 * 60_000),
    )
    if (stalled.length > 0 || removed > 0) {
      log.info({ stalled: stalled.length, removed }, 'tasks maintained')
    }
  },
})
