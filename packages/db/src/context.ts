import type { Database } from './connection'
import type { JobsRuntime } from './jobs/types'
import type { Storage } from './storage/types'

/** What every data-layer module receives. Built once by openData(). */
export interface DataContext {
  db: Database
  jobs: JobsRuntime
  storage: Storage
  /** Injectable clock (tests move it). */
  now: () => Date
  log: DataLog
}

/** Where the data layer reports what it recovers from. A pino logger fits it. */
export interface DataLog {
  error(fields: object, message: string): void
}

export const consoleLog: DataLog = {
  error: (fields, message) => console.error(`[data] ${message}`, fields),
}
