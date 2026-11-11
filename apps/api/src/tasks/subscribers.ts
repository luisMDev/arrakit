import type { TaskEventName } from '@arrakit/db'

import { type EventSubscriber, defineEventSubscriber } from '../events/subscribers'

export type TaskSubscriber<E extends TaskEventName = TaskEventName> = EventSubscriber<E>

export const defineTaskSubscriber: <E extends TaskEventName>(
  subscriber: TaskSubscriber<E>,
) => TaskSubscriber<E> = defineEventSubscriber

/**
 * What runs when a task succeeds or fails, whatever its kind: check `payload.kind` to react to
 * one. Add a subscriber here to react.
 */
export const TASK_SUBSCRIBERS: readonly TaskSubscriber[] = []
