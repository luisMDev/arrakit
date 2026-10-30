import type { MiddlewareHandler } from 'hono'
import { every } from 'hono/combine'
import { requestId } from 'hono/request-id'

import type { Logger } from './logger'

declare module 'hono' {
  interface ContextVariableMap {
    /** The app logger bound to this request's id. */
    log: Logger
  }
}

/**
 * Gives every request an id (X-Request-Id, echoed back), a logger bound to it (`c.get('log')`)
 * and one access line when it ends (warn for a 5xx: its cause is logged as an error where it
 * happened).
 */
export function requestLog(log: Logger): MiddlewareHandler {
  return every(requestId(), async (c, next) => {
    const requestLog = log.child({ requestId: c.get('requestId') })
    c.set('log', requestLog)
    const started = performance.now()
    await next()
    const { status } = c.res
    const line = {
      method: c.req.method,
      path: c.req.path,
      status,
      ms: Math.round(performance.now() - started),
    }
    if (status >= 500) requestLog.warn(line, 'request failed')
    else requestLog.info(line, 'request')
  })
}
