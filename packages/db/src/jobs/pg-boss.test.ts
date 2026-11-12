import { PGlite } from '@electric-sql/pglite'
import { fromPglite } from 'pg-boss'

import { pgBossJobs } from './pg-boss'
import { describeJobs, type JobsTarget } from './pg-boss-suite'
import { consoleLog } from '../context'

/**
 * The real pg-boss runtime on PGlite, through pg-boss's own `pglite` backend. PGlite is a single
 * connection, so row-lock waits between connections are only exercised by pg-boss.stack.test.ts,
 * which runs the same suite through the local stack's pooler.
 */
const pgliteTarget: JobsTarget = {
  name: 'PGlite (pg-boss pglite backend)',
  async open() {
    const pg = await PGlite.create()
    const jobs = await pgBossJobs({ db: fromPglite(pg), backend: 'pglite' }, consoleLog)
    const stop = jobs.stop.bind(jobs)
    return {
      jobs: Object.assign(jobs, {
        stop: async () => {
          await stop()
          if (!pg.closed) await pg.close()
        },
      }),
      sql: async (text, values) => (await pg.query(text, values)).rows,
    }
  },
}

describeJobs(pgliteTarget)
