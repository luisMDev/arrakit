import { describe, expect, it } from 'vitest'

import { loadLogEnv } from '../env'
import { recordingLogger } from './logger'

describe('logger', () => {
  it('writes one JSON object per line with a level label, a time and the service', () => {
    const { log, logs } = recordingLogger('info')
    log.info({ organizationId: 'org_1' }, 'topped up')
    expect(logs).toEqual([
      expect.objectContaining({
        level: 'info',
        msg: 'topped up',
        service: 'api',
        organizationId: 'org_1',
        time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    ])
  })

  it('drops entries below its level', () => {
    const { log, logs } = recordingLogger('warn')
    log.info('quiet')
    log.warn('loud')
    expect(logs.map((line) => line.msg)).toEqual(['loud'])
  })

  it('serializes an error with its stack and cause', () => {
    const { log, logs } = recordingLogger('info')
    log.error({ err: new Error('send failed', { cause: new Error('socket hang up') }) }, 'failed')
    expect(logs[0]?.err).toMatchObject({
      type: 'Error',
      message: expect.stringContaining('send failed'),
      stack: expect.stringContaining('send failed'),
    })
    expect(JSON.stringify(logs[0]?.err)).toContain('socket hang up')
  })
})

describe('log env', () => {
  it('is silent in tests, info elsewhere; pretty only in development', () => {
    expect(loadLogEnv({ NODE_ENV: 'test' })).toEqual({ LOG_LEVEL: 'silent', LOG_FORMAT: 'json' })
    expect(loadLogEnv({})).toEqual({ LOG_LEVEL: 'info', LOG_FORMAT: 'pretty' })
    expect(loadLogEnv({ NODE_ENV: 'production' })).toEqual({
      LOG_LEVEL: 'info',
      LOG_FORMAT: 'json',
    })
  })

  it('takes LOG_LEVEL and LOG_FORMAT when set, and refuses unknown values', () => {
    expect(loadLogEnv({ LOG_LEVEL: 'debug', LOG_FORMAT: 'json' })).toEqual({
      LOG_LEVEL: 'debug',
      LOG_FORMAT: 'json',
    })
    expect(() => loadLogEnv({ LOG_LEVEL: 'loud' })).toThrow()
  })
})
