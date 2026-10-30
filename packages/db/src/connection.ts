import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import pg from 'pg'

import * as schema from './schema/index'

export type Schema = typeof schema

/** Drizzle over node-postgres or PGlite; transactions are assignable to it too. */
export type Database = PgDatabase<PgQueryResultHKT, Schema>

export interface ConnectionConfig {
  /** Real Postgres. When absent, PGlite is used. */
  databaseUrl?: string
  /** PGlite data directory. Absent (or 'memory://') means in-memory. */
  pgliteDir?: string
  /** Delete the PGlite directory before opening it (throwaway e2e databases). */
  pgliteReset?: boolean
  /** Where the drizzle-kit migrations live. Defaults to the package's ./drizzle folder. */
  migrationsFolder?: string
}

export interface Connection {
  db: Database
  driver: 'postgres' | 'pglite'
  /** Applies pending migrations (under an advisory lock on Postgres). Idempotent. */
  migrate(): Promise<void>
  ping(): Promise<void>
  close(): Promise<void>
}

/** Key of the advisory lock held while migrating, so two instances booting together serialize. */
export const MIGRATION_LOCK = 724083001

/**
 * The migrations folder. From source it is packages/db/drizzle; in the bundled API (tsdown copies
 * the folder next to dist/main.mjs) it is ./drizzle beside the bundle.
 */
export function defaultMigrationsFolder(): string {
  const bundled = fileURLToPath(new URL('./drizzle', import.meta.url))
  if (existsSync(bundled)) return bundled
  return fileURLToPath(new URL('../drizzle', import.meta.url))
}

/** Opens Drizzle over node-postgres when DATABASE_URL is set, otherwise over PGlite. */
export async function connect(config: ConnectionConfig = {}): Promise<Connection> {
  const migrationsFolder = config.migrationsFolder ?? defaultMigrationsFolder()

  if (config.databaseUrl) {
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: 5000,
    })
    return postgresConnection(pool, migrationsFolder)
  }

  const dir = config.pgliteDir && config.pgliteDir !== 'memory://' ? config.pgliteDir : undefined
  if (dir && config.pgliteReset) rmSync(dir, { recursive: true, force: true })
  if (dir) mkdirSync(dirname(dir), { recursive: true })
  const client = new PGlite(dir ?? 'memory://')
  await client.waitReady
  const db = drizzlePglite({ client, schema })
  return {
    db: db as unknown as Database,
    driver: 'pglite',
    migrate: () => migratePglite(db, { migrationsFolder }),
    ping: async () => {
      await db.execute(sql`select 1`)
    },
    close: () => client.close(),
  }
}

/** Drizzle over a node-postgres pool; migrations run on one client under MIGRATION_LOCK. */
export function postgresConnection(pool: pg.Pool, migrationsFolder: string): Connection {
  // An idle client failing must not crash the process.
  pool.on('error', (err) => console.error('[data] idle Postgres client failed:', err))
  const db = drizzlePg({ client: pool, schema })
  return {
    db: db as unknown as Database,
    driver: 'postgres',
    migrate: async () => {
      const client = await pool.connect()
      let release: Error | undefined
      try {
        await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK])
        try {
          await migratePg(drizzlePg({ client, schema }), { migrationsFolder })
        } finally {
          try {
            await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK])
          } catch (err) {
            release = err as Error
          }
        }
      } finally {
        client.release(release)
      }
    },
    ping: async () => {
      await db.execute(sql`select 1`)
    },
    close: () => pool.end(),
  }
}
