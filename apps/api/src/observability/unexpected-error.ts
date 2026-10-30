import { ORPCError } from '@orpc/server'

import type { ErrorReporter, ErrorTags } from './error-reporter'
import type { Logger } from './logger'

/**
 * A bug or an outage rather than a refusal: anything that is not an ORPCError, or the 500
 * oRPC makes from one. Deliberate refusals (4xx, 502, 503) are logged where they are thrown.
 */
export function isUnexpected(error: unknown): boolean {
  return !(error instanceof ORPCError) || error.code === 'INTERNAL_SERVER_ERROR'
}

/**
 * Logs `error` with `tags` and sends it to the error tracker, tagged with the request id the
 * logger is bound to.
 */
export function reportUnexpected(
  log: Logger,
  errors: ErrorReporter,
  error: unknown,
  tags: ErrorTags,
): void {
  log.error({ err: error, ...tags }, 'unexpected error')
  const { requestId } = log.bindings() as { requestId?: string }
  errors.capture(error, { ...tags, requestId })
}
