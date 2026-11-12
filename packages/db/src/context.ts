import type { Database } from './connection'
import type { JobsRuntime } from './jobs/types'
import type { Scoped } from './organization/scoped'
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

/** What an organization scope module receives: no privileged database, only scoped work. */
export type ScopeContext = Omit<DataContext, 'db'> & { scoped: Scoped }

/** Where the data layer reports what it recovers from. A pino logger fits it. */
export interface DataLog {
  info(message: string): void
  error(fields: object, message: string): void
}

export const consoleLog: DataLog = {
  info: (message) => console.info(`[data] ${message}`),
  error: (fields, message) => console.error(`[data] ${message}`, fields),
}
