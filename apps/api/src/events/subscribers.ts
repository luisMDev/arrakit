import {
  type FileEventName,
  type FileEventPayloads,
  type QueuePolicy,
  type TaskEventName,
  type TaskEventPayloads,
  WORKER_RETRY_POLICY,
} from '@arrakit/db'

import { FILE_EVENT_SCHEMAS } from '../files/events'
import { TASK_EVENT_SCHEMAS } from '../tasks/events'
import {
  type JobContext,
  type JobDefinition,
  type WorkerDeps,
  defineJob,
  registerJobs,
} from '../workers/job'

export type EventName = FileEventName | TaskEventName
export type EventPayloads = FileEventPayloads & TaskEventPayloads

const EVENT_SCHEMAS = { ...FILE_EVENT_SCHEMAS, ...TASK_EVENT_SCHEMAS }

/**
 * Reacts to a domain event in the background: each subscriber has its own queue, so it retries
 * and dead-letters on its own, and an event published inside a rolled-back change never reaches
 * it.
 */
export interface EventSubscriber<E extends EventName = EventName> {
  /** Unique per event; the queue is `<event>.<name>`. */
  name: string
  event: E
  handler(payload: EventPayloads[E], context: JobContext): Promise<void>
  policy?: QueuePolicy
}

export const defineEventSubscriber = <E extends EventName>(
  subscriber: EventSubscriber<E>,
): EventSubscriber<E> => subscriber

export const subscriberQueue = (subscriber: EventSubscriber) =>
  `${subscriber.event}.${subscriber.name}`

export function subscriberJob(subscriber: EventSubscriber): JobDefinition {
  return defineJob({
    name: subscriberQueue(subscriber),
    schema: EVENT_SCHEMAS[subscriber.event],
    policy: subscriber.policy ?? WORKER_RETRY_POLICY,
    handler: (payload, context) => subscriber.handler(payload as never, context),
    logFields: (payload) => {
      const { organizationId, fileId, taskId } = payload as {
        organizationId: string
        fileId?: string
        taskId?: string
      }
      return { organizationId, fileId, taskId }
    },
  })
}

/** Starts each subscriber's worker, then subscribes its queue to the event. */
export async function registerEventSubscribers(
  subscribers: readonly EventSubscriber[],
  deps: WorkerDeps,
): Promise<void> {
  await registerJobs(subscribers.map(subscriberJob), deps)
  for (const subscriber of subscribers) {
    await deps.data.jobs.subscribe(subscriber.event, subscriberQueue(subscriber))
  }
}
