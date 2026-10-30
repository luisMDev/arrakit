import { serve } from '@hono/node-server'

import { createApp } from './app'
import { loadLogEnv } from './env'
import { createLogger } from './observability/logger'
import { closeMcpHandlers } from './routes/mcp'
import { depsFromEnv } from './services'
import { registerWorkers } from './workers/index'

const log = createLogger(loadLogEnv(process.env))

async function main() {
  const deps = await depsFromEnv(process.env, log)
  await registerWorkers(deps)
  const app = createApp(deps)
  const server = serve({ fetch: app.fetch, port: deps.env.PORT }, (info) => {
    log.info({ port: info.port, driver: deps.data.driver }, 'listening')
  })

  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    const stopped = new Promise<void>((resolve) => server.close(() => resolve()))
    // Streams still open on the MCP handlers would keep server.close() waiting.
    const closed = closeMcpHandlers()
      .then(() => stopped)
      .then(() => deps.data.close())
      .catch((err: unknown) => log.error({ err }, 'shutdown failed'))
    void Promise.allSettled([closed, deps.errors.flush()]).finally(() => process.exit(0))
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err: unknown) => {
  log.fatal({ err }, 'failed to start')
  process.exit(1)
})
