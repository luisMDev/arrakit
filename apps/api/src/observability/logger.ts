import { type DestinationStream, type Logger, type LoggerOptions, pino } from 'pino'

import type { LogEnv } from '../env'

export type { Logger } from 'pino'

export interface LogEntry {
  level: string
  msg: string
  [field: string]: unknown
}

const options = (level: string): LoggerOptions => ({
  level,
  base: { service: 'api' },
  formatters: { level: (label) => ({ level: label }) },
  serializers: { err: pino.stdSerializers.errWithCause },
  timestamp: pino.stdTimeFunctions.isoTime,
})

/** JSON lines on stdout (or `destination`); `pretty` renders them with pino-pretty for a terminal. */
export function createLogger(env: LogEnv, destination?: DestinationStream): Logger {
  if (env.LOG_FORMAT === 'pretty') {
    return pino({
      ...options(env.LOG_LEVEL),
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          singleLine: true,
          ignore: 'pid,hostname,service',
          translateTime: 'SYS:HH:MM:ss',
        },
      },
    })
  }
  return pino(options(env.LOG_LEVEL), destination)
}

/** Test logger: every entry, parsed, in `logs` (newest last). */
export function recordingLogger(level: LogEnv['LOG_LEVEL'] = 'debug'): {
  log: Logger
  logs: LogEntry[]
} {
  const logs: LogEntry[] = []
  const log = createLogger(
    { LOG_LEVEL: level, LOG_FORMAT: 'json' },
    { write: (line: string) => void logs.push(JSON.parse(line) as LogEntry) },
  )
  return { log, logs }
}
