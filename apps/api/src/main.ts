import { serve } from '@hono/node-server'

import { createApp } from './app'
import { loadLogEnv } from './env'
import { createLogger } from './observability/logger'
import { mcpHandler } from './routes/mcp'
import { depsFromEnv } from './services'
import { registerWorkers } from './workers'

const log = createLogger(loadLogEnv(process.env))

async function main() {
  const deps = await depsFromEnv(process.env, log)
  await registerWorkers(deps)
  deps.data.taskFeed.probe().catch((err: unknown) => {
    log.error({ err }, 'task feed receives no notices; live task updates will lag')
  })
  const mcp = mcpHandler(log)
  const app = createApp(deps, mcp)
  const server = serve({ fetch: app.fetch, port: deps.env.PORT }, (info) => {
    log.info({ port: info.port }, 'listening')
  })

  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    deps.taskWatches.close()
    const stopped = new Promise<void>((resolve) => server.close(() => resolve()))
    // Streams still open on the MCP handler would keep server.close() waiting.
    const closed = Promise.allSettled([mcp.close()])
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
