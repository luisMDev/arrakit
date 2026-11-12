import { type QueuePolicy, WORKER_RETRY_POLICY } from '@arrakit/db'

import {
  type JobContext,
  type JobDefinition,
  type WorkerDeps,
  defineJob,
  registerJobs,
} from '../workers/job'
import type { EventDomain } from './domain'

/**
 * Reacts to a domain event in the background: each subscriber has its own queue, so it retries
 * and dead-letters on its own, and an event published inside a rolled-back change never reaches
 * it.
 */
export interface EventSubscriber {
  event: string
  /** The worker on the subscriber's own queue, `<event>.<name>`. */
  job: JobDefinition
}

export function defineEventSubscriber<
  Payloads extends Record<keyof Payloads, object>,
  E extends keyof Payloads & string,
>(
  domain: EventDomain<Payloads>,
  subscriber: {
    /** Unique per event. */
    name: string
    event: E
    handler(payload: Payloads[E], context: JobContext): Promise<void>
    policy?: QueuePolicy
  },
): EventSubscriber {
  return {
    event: subscriber.event,
    job: defineJob({
      name: `${subscriber.event}.${subscriber.name}`,
      schema: domain.schemas[subscriber.event],
      policy: subscriber.policy ?? WORKER_RETRY_POLICY,
      handler: (payload, context) => subscriber.handler(payload, context),
      logFields: domain.logFields,
    }),
  }
}

/** Starts each subscriber's worker, then subscribes its queue to the event. */
export async function registerEventSubscribers(
  subscribers: readonly EventSubscriber[],
  deps: WorkerDeps,
): Promise<void> {
  await registerJobs(
    subscribers.map(({ job }) => job),
    deps,
  )
  for (const { event, job } of subscribers) await deps.data.jobs.subscribe(event, job.name)
}
