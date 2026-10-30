import type { Database } from '../connection'

export interface RetryPolicy {
  retryLimit: number
  /** Seconds before the first retry. */
  retryDelay: number
  retryBackoff: boolean
  expireInSeconds?: number
}

export interface JobRecord {
  id: string
  state: 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed'
  data: object
}

export interface SendOptions {
  startAfter?: Date
}

/**
 * A database connection a job can be written through. Inside an open transaction, the job
 * commits or rolls back with that transaction (pg-boss `{ db }`).
 */
export interface JobConnection {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}

export interface Jobs {
  /**
   * Creates `<name>__dead`, then `<name>` dead-lettering into it. A queue that already exists
   * keeps the policy it was created with; redefining it as exclusive when it is not throws.
   */
  defineQueue(name: string, policy: RetryPolicy, options?: { exclusive?: boolean }): Promise<void>
  /** Throws if the job was not queued. */
  send(name: string, data: object, options?: SendOptions): Promise<string>
  /** Exclusive queue: false when a job with `key` is created, retrying or active. */
  sendOnce(name: string, data: object, key: string, options?: SendOptions): Promise<boolean>
  /** Cron in UTC; missed ticks run once; one schedule per queue (a new one replaces it). */
  schedule(name: string, cron: string, data: object): Promise<void>
  work<T extends object>(
    name: string,
    handler: (data: T) => Promise<void>,
    options?: { pollingIntervalSeconds?: number },
  ): Promise<void>
  find(name: string, filter?: { id?: string }): Promise<JobRecord[]>
  /** Default expiry is 900 s. */
  queuePolicy(name: string): Promise<Required<RetryPolicy> | undefined>
}

/** A running implementation: health probe and graceful stop. */
export interface JobsRuntime extends Jobs {
  readonly kind: 'pg-boss' | 'in-process' | 'memory'
  /** Throws when the runner is stopped or unreachable. */
  probe(signal?: AbortSignal): Promise<void>
  /** Graceful: waits for running handlers. Idempotent. */
  stop(): Promise<void>
  /**
   * `send` written through `connection` instead of the runner's own pool, so a job sent inside a
   * transaction commits with it. Only runners that keep jobs in the database have it; for the
   * others, transactionWithJobs() sends after commit.
   */
  sendOn?(
    connection: JobConnection,
    name: string,
    data: object,
    options?: SendOptions & { id?: string },
  ): Promise<string>
  /** `send` with a caller-chosen job id (a UUID), so an id handed out before commit stays true. */
  sendWithId?(id: string, name: string, data: object, options?: SendOptions): Promise<string>
}

export const deadLetterOf = (name: string) => `${name}__dead`

export const DEFAULT_EXPIRE_IN_SECONDS = 900

export const WORKER_RETRY_POLICY: RetryPolicy = {
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
}

/** A transaction, as drizzle hands one to `db.transaction`'s callback. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Sends a job as part of the transaction it came with; resolves to the job id. */
type SendInTransaction = (name: string, data: object, options?: SendOptions) => Promise<string>

/**
 * Runs `work` in one transaction with a `send` bound to it: the rows `tx` writes and the jobs
 * `send` queues commit together, or neither does when `work` throws. Not organization-scoped:
 * an organization being created has no id yet.
 */
export type TransactionWithJobs = <R>(
  work: (tx: Transaction, send: SendInTransaction) => Promise<R>,
) => Promise<R>
