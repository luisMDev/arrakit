import { ORPCError } from '@orpc/server'
import * as Sentry from '@sentry/node'

import type { ApiEnv } from '../env'
import type { Logger } from './logger'

/** Searchable labels attached to a reported error (request id, route, procedure...). */
export type ErrorTags = Record<string, string | undefined>

export interface ErrorReporter {
  /** Sends an unexpected error to the error tracker. Never throws. */
  capture(error: unknown, tags?: ErrorTags): void
  /** Waits for queued reports to be sent (shutdown). */
  flush(): Promise<void>
}

export const noErrorReporter: ErrorReporter = {
  capture: () => {},
  flush: async () => {},
}

type SentryEnv = Pick<ApiEnv, 'NODE_ENV' | 'SENTRY_DSN' | 'SENTRY_ENVIRONMENT' | 'SENTRY_RELEASE'>

/** Sentry when SENTRY_DSN is set; otherwise errors are only logged. */
export function createErrorReporter(env: SentryEnv): ErrorReporter {
  if (!env.SENTRY_DSN) return noErrorReporter
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.SENTRY_RELEASE,
  })
  return {
    capture(error, tags = {}) {
      Sentry.captureException(error, { tags })
    },
    async flush() {
      await Sentry.flush(2000)
    },
  }
}

export interface CapturedError {
  error: unknown
  tags: ErrorTags
}

/** Test reporter: every captured error in `captured`. */
export function recordingErrorReporter(): { errors: ErrorReporter; captured: CapturedError[] } {
  const captured: CapturedError[] = []
  return {
    captured,
    errors: {
      capture: (error, tags = {}) => void captured.push({ error, tags }),
      flush: async () => {},
    },
  }
}

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
