import { serve } from '@hono/node-server'

import { createApp } from './app'
import { closeMcpHandlers } from './routes/mcp'
import { depsFromEnv } from './services'
import { registerWorkers } from './workers/index'

async function main() {
  const deps = await depsFromEnv(process.env)
  await registerWorkers(deps.data)
  const app = createApp(deps)
  const server = serve({ fetch: app.fetch, port: deps.env.PORT }, (info) => {
    console.log(`[api] listening on http://localhost:${info.port} (${deps.data.driver})`)
  })

  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    const stopped = new Promise<void>((resolve) => server.close(() => resolve()))
    // Streams still open on the MCP handlers would keep server.close() waiting.
    void closeMcpHandlers()
      .then(() => stopped)
      .then(() => deps.data.close())
      .catch((err: unknown) => console.error('[api] shutdown failed', err))
      .finally(() => process.exit(0))
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err: unknown) => {
  console.error('[api] failed to start', err)
  process.exit(1)
})
