import * as Sentry from '@sentry/node'

import type { ApiEnv } from '../env'

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
