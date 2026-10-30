import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import pg from 'pg'

import * as schema from './schema/index'

export interface ConnectionConfig {
  /** Real Postgres. When absent, PGlite is used. */
  databaseUrl?: string
  /** PGlite data directory. Absent (or 'memory://') means in-memory. */
  pgliteDir?: string
}

export type Database =
  ReturnType<typeof drizzlePglite<typeof schema>> | ReturnType<typeof drizzlePg<typeof schema>>

export interface Connection {
  db: Database
  driver: 'postgres' | 'pglite'
  ping(): Promise<void>
  close(): Promise<void>
}

/** Opens Drizzle over node-postgres when DATABASE_URL is set, otherwise over PGlite. */
export async function connect(config: ConnectionConfig = {}): Promise<Connection> {
  if (config.databaseUrl) {
    const pool = new pg.Pool({ connectionString: config.databaseUrl })
    const db = drizzlePg({ client: pool, schema })
    return {
      db,
      driver: 'postgres',
      ping: async () => {
        await db.execute(sql`select 1`)
      },
      close: () => pool.end(),
    }
  }
  const client = new PGlite(config.pgliteDir ?? 'memory://')
  await client.waitReady
  const db = drizzlePglite({ client, schema })
  return {
    db,
    driver: 'pglite',
    ping: async () => {
      await db.execute(sql`select 1`)
    },
    close: () => client.close(),
  }
}
