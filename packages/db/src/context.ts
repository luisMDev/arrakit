import type { Database } from './connection'
import type { JobsRuntime } from './jobs/types'
import type { DataLog } from './log'
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
