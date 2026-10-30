import { randomUUID } from 'node:crypto'

import type { Database } from '../connection'
import type {
  JobConnection,
  JobsRuntime,
  SendOptions,
  Transaction,
  TransactionWithJobs,
} from './types'

interface QueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}

/**
 * The driver client a drizzle transaction runs on (a node-postgres PoolClient or a PGlite
 * transaction). drizzle keeps it on the transaction's session without a public accessor.
 */
export function jobConnectionOf(tx: Transaction): JobConnection {
  const client = (tx as unknown as { session?: { client?: Partial<QueryClient> } }).session?.client
  if (typeof client?.query !== 'function') {
    throw new Error('[data] cannot reach the client of this transaction to write jobs through it')
  }
  const query = client.query.bind(client) as QueryClient['query']
  return { executeSql: async (text, values) => ({ rows: (await query(text, values)).rows }) }
}

/**
 * With a runner that keeps jobs in the database (pg-boss), jobs are written through the
 * transaction's own connection. Otherwise (in-process, memory) they are held and sent once the
 * transaction commits, and dropped when it rolls back; their ids are chosen up front.
 */
export function transactionWithJobs(db: Database, jobs: JobsRuntime): TransactionWithJobs {
  return async (work) => {
    const held: { id: string; name: string; data: object; options?: SendOptions }[] = []
    const result = await db.transaction(async (tx) => {
      const sendOn = jobs.sendOn?.bind(jobs)
      const connection = sendOn ? jobConnectionOf(tx) : undefined
      return work(tx, async (name, data, options) => {
        if (sendOn && connection) return sendOn(connection, name, data, options)
        const id = randomUUID()
        held.push({ id, name, data, options })
        return id
      })
    })
    for (const job of held) {
      if (jobs.sendWithId) await jobs.sendWithId(job.id, job.name, job.data, job.options)
      else await jobs.send(job.name, job.data, job.options)
    }
    return result
  }
}
