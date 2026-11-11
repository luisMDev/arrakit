import type { ArtifactEventName } from '@arrakit/db'

import { type EventSubscriber, defineEventSubscriber } from '../events/subscribers'

export type ArtifactSubscriber<E extends ArtifactEventName = ArtifactEventName> = EventSubscriber<E>

export const defineArtifactSubscriber: <E extends ArtifactEventName>(
  subscriber: ArtifactSubscriber<E>,
) => ArtifactSubscriber<E> = defineEventSubscriber

/**
 * What runs when an artifact is created, gets a new version, is renamed or deleted. Add a
 * subscriber here to react.
 */
export const ARTIFACT_SUBSCRIBERS: readonly ArtifactSubscriber[] = []
