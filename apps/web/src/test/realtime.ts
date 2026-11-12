import { afterEach } from 'vitest'

import type * as Realtime from '#/lib/realtime'

/** The topics the fake hands to `pickTopic`, as the API names them for a reader. */
export const FAKE_TOPICS = { tasks: 'org:test-org:tasks' }

/** One channel joined through the fake; firing on a closed channel does nothing, as for real. */
export interface FakeChannel {
  readonly topic: string
  readonly event: string
  /** True once the code under test closed it, or after `down()`. */
  readonly closed: boolean
  subscribed(): void
  message(payload: unknown): void
  down(): void
}

const joins: FakeChannel[] = []

/**
 * Stands in for '#/lib/realtime':
 * `vi.mock('#/lib/realtime', async () => (await import('#/test/realtime')).fakeRealtime)`.
 */
export const fakeRealtime: typeof Realtime = {
  joinChannel(pickTopic, event, handlers) {
    let closed = false
    joins.push({
      topic: pickTopic(FAKE_TOPICS),
      event,
      get closed() {
        return closed
      },
      subscribed: () => {
        if (!closed) handlers.subscribed()
      },
      message: (payload) => {
        if (!closed) handlers.message(payload)
      },
      down: () => {
        if (closed) return
        closed = true
        handlers.down()
      },
    })
    return {
      close: () => {
        closed = true
      },
    }
  },
}

/** The channels joined through the fake in this test, oldest first; emptied after each test. */
export function setupFakeRealtime(): readonly FakeChannel[] {
  afterEach(() => {
    joins.length = 0
  })
  return joins
}
