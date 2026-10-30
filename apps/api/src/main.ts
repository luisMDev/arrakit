import { serve } from '@hono/node-server'

import { createApp } from './app'

const port = Number(process.env.PORT ?? 3000)
const app = createApp()

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`)
})

function shutdown() {
  server.close(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
