import type { FileEventName } from '@arrakit/db'

import { type EventSubscriber, defineEventSubscriber } from '../events/subscribers'

export type FileSubscriber<E extends FileEventName = FileEventName> = EventSubscriber<E>

export const defineFileSubscriber: <E extends FileEventName>(
  subscriber: FileSubscriber<E>,
) => FileSubscriber<E> = defineEventSubscriber

/** What runs when a file is uploaded, renamed or deleted. Add a subscriber here to react. */
export const FILE_SUBSCRIBERS: readonly FileSubscriber[] = []
