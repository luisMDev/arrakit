import pg from 'pg'

import { pgBossJobs } from './pg-boss'
import { describeJobs, type JobsTarget } from './pg-boss-suite'
import { consoleLog } from '../context'
import { stackEnv } from '../testing'

const poolerTarget: JobsTarget = {
  name: 'the local stack (transaction pooler)',
  async open() {
    const url = stackEnv().DATABASE_URL
    const pool = new pg.Pool({ connectionString: url, max: 1 })
    const jobs = await pgBossJobs(url, consoleLog)
    const stop = jobs.stop.bind(jobs)
    return {
      jobs: Object.assign(jobs, {
        stop: async () => {
          await stop()
          if (!pool.ended) await pool.end()
        },
      }),
      sql: async (text, values) => (await pool.query(text, values)).rows,
    }
  },
}

describeJobs(poolerTarget)
