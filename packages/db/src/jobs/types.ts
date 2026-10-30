export interface RetryPolicy {
  retryLimit: number
  /** Seconds before the first retry. */
  retryDelay: number
  retryBackoff: boolean
  expireInSeconds?: number
}

export interface Jobs {
  /**
   * Creates `<name>__dead`, then `<name>` dead-lettering into it. A queue that already exists
   * keeps the policy it was created with.
   */
  defineQueue(name: string, policy: RetryPolicy): Promise<void>
  /** Throws if the job was not queued. */
  send(name: string, data: object): Promise<string>
  work<T extends object>(name: string, handler: (data: T) => Promise<void>): Promise<void>
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

export const WORKER_RETRY_POLICY: RetryPolicy = {
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
}
