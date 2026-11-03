import {
  type FileEventName,
  type FileEventPayloads,
  type QueuePolicy,
  WORKER_RETRY_POLICY,
} from '@arrakit/db'

import {
  type JobContext,
  type JobDefinition,
  type WorkerDeps,
  defineJob,
  registerJobs,
} from '../workers/job'
import { FILE_EVENT_SCHEMAS } from './events'

/**
 * Reacts to a file event in the background: each subscriber has its own queue, so it retries and
 * dead-letters on its own, and an event published inside a rolled-back change never reaches it.
 */
export interface FileSubscriber<E extends FileEventName = FileEventName> {
  /** Unique per event; the queue is `<event>.<name>`. */
  name: string
  event: E
  handler(payload: FileEventPayloads[E], context: JobContext): Promise<void>
  policy?: QueuePolicy
}

export const defineFileSubscriber = <E extends FileEventName>(
  subscriber: FileSubscriber<E>,
): FileSubscriber<E> => subscriber

export const subscriberQueue = (subscriber: FileSubscriber) =>
  `${subscriber.event}.${subscriber.name}`

export function subscriberJob(subscriber: FileSubscriber): JobDefinition {
  return defineJob({
    name: subscriberQueue(subscriber),
    schema: FILE_EVENT_SCHEMAS[subscriber.event],
    policy: subscriber.policy ?? WORKER_RETRY_POLICY,
    handler: (payload, context) => subscriber.handler(payload as never, context),
    logFields: ({ organizationId, fileId }) => ({ organizationId, fileId }),
  })
}

/** Starts each subscriber's worker, then subscribes its queue to the event. */
export async function registerFileSubscribers(
  subscribers: readonly FileSubscriber[],
  deps: WorkerDeps,
): Promise<void> {
  await registerJobs(subscribers.map(subscriberJob), deps)
  for (const subscriber of subscribers) {
    await deps.data.jobs.subscribe(subscriber.event, subscriberQueue(subscriber))
  }
}

/** What runs when a file is uploaded, renamed or deleted. Add a subscriber here to react. */
export const FILE_SUBSCRIBERS: readonly FileSubscriber[] = []
