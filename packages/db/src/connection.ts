import { drizzle } from 'drizzle-orm/node-postgres'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import pg from 'pg'

import type { DataLog } from './context'
import { pgBossJobs } from './jobs/pg-boss'
import type { JobsRuntime } from './jobs/types'
import * as schema from './schema/index'

type Schema = typeof schema

/** Drizzle over node-postgres (over PGlite in tests); transactions are assignable to it too. */
export type Database = PgDatabase<PgQueryResultHKT, Schema>

export interface ConnectionConfig {
  /** Postgres, reached directly or through a pooler in transaction mode. */
  databaseUrl: string
}

/** An open database and what runs on it. */
export interface Connection {
  db: Database
  /** pg-boss in its own schema of this database. */
  openJobs(log: DataLog): Promise<JobsRuntime>
  close(): Promise<void>
}

/** Runs `work` in one transaction, handed over as a plain Database. */
export function transaction<R>(db: Database, work: (tx: Database) => Promise<R>): Promise<R> {
  return db.transaction((tx) => work(tx as unknown as Database))
}

/** Opens Drizzle over a node-postgres pool. Nothing is sent until the first query. */
export function connect(config: ConnectionConfig, log: DataLog): Connection {
  return postgresConnection(
    new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 }),
    config,
    log,
  )
}

export function postgresConnection(
  pool: pg.Pool,
  config: ConnectionConfig,
  log: DataLog,
): Connection {
  // An idle client failing must not crash the process.
  pool.on('error', (err) => log.error({ err }, 'idle Postgres client failed'))
  return {
    db: drizzle({ client: pool, schema }) as unknown as Database,
    openJobs: (jobsLog) => pgBossJobs(config.databaseUrl, jobsLog),
    close: () => pool.end(),
  }
}
