/**
 * How many jobs sharing a `singletonKey` the queue accepts (pg-boss queue policies). With
 * `standard` the key does not deduplicate.
 * - `short`: one queued job per key.
 * - `singleton`: one active job per key, any number queued.
 * - `stately`: one queued and one active job per key.
 * - `exclusive`: one queued or active job per key.
 */
export type Exclusivity = 'standard' | 'short' | 'singleton' | 'stately' | 'exclusive'

export interface QueuePolicy {
  retryLimit: number
  /** Seconds before the first retry. */
  retryDelay: number
  retryBackoff: boolean
  expireInSeconds?: number
  exclusivity?: Exclusivity
}

export interface SendOptions {
  /** A date, or a delay in seconds. */
  startAfter?: Date | number
  singletonKey?: string
  /** Higher runs first. */
  priority?: number
}

export interface ScheduleOptions {
  /** IANA time zone the cron expression is read in. Defaults to UTC. */
  tz?: string
}

export interface Jobs {
  /**
   * Creates `<name>__dead`, then `<name>` dead-lettering into it. A queue that already exists
   * keeps the policy it was created with.
   */
  defineQueue(name: string, policy: QueuePolicy): Promise<void>
  /**
   * Resolves to the job id, or to null when the queue's exclusivity refused a duplicate
   * `singletonKey`. Throws if the job was not queued for any other reason.
   */
  send(name: string, data: object, options?: SendOptions): Promise<string | null>
  work<T extends object>(name: string, handler: (data: T) => Promise<void>): Promise<void>
  /** Queues `data` straight onto `<name>__dead`, for a job that retrying cannot fix. */
  deadLetter(name: string, data: object): Promise<void>
  /** Sends `data` to `name` on every cron occurrence, replacing the queue's previous schedule. */
  schedule(name: string, cron: string, data: object, options?: ScheduleOptions): Promise<void>
  /** Removes the queue's schedule, if any. */
  unschedule(name: string): Promise<void>
}

/** A running implementation: health probe and graceful stop. */
export interface JobsRuntime extends Jobs {
  /** Throws when the runner is stopped or unreachable. */
  probe(signal?: AbortSignal): Promise<void>
  /** Graceful: waits for running handlers. Idempotent. */
  stop(): Promise<void>
}

export const deadLetterOf = (name: string) => `${name}__dead`

export const DEFAULT_EXPIRE_IN_SECONDS = 900

export const WORKER_RETRY_POLICY: QueuePolicy = {
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
}
