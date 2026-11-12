import { describe, expect, it } from 'vitest'

import { loadApiEnv } from './env'

const URL = 'http://127.0.0.1:54321'
const jwtWithRole = (role: string) =>
  ['{"alg":"HS256"}', JSON.stringify({ role })]
    .map((part) => Buffer.from(part).toString('base64url'))
    .concat('signature')
    .join('.')

describe('loadApiEnv: the Supabase project', () => {
  it('is null when neither variable is set', () => {
    expect(loadApiEnv({}).supabase).toBeNull()
    expect(loadApiEnv({ SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' }).supabase).toBeNull()
  })

  it('is the pair when both are set', () => {
    expect(
      loadApiEnv({ SUPABASE_URL: URL, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }).supabase,
    ).toEqual({ url: URL, publishableKey: 'sb_publishable_x' })
    expect(
      loadApiEnv({ SUPABASE_URL: URL, SUPABASE_PUBLISHABLE_KEY: jwtWithRole('anon') }).supabase,
    ).toEqual({ url: URL, publishableKey: jwtWithRole('anon') })
  })

  it('refuses one without the other', () => {
    const message = '[api] SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY go together'
    expect(() => loadApiEnv({ SUPABASE_URL: URL })).toThrow(message)
    expect(() => loadApiEnv({ SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' })).toThrow(message)
  })

  it('refuses a secret key, so none reaches a browser', () => {
    const message = '[api] SUPABASE_PUBLISHABLE_KEY must be a publishable key'
    expect(() =>
      loadApiEnv({ SUPABASE_URL: URL, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_x' }),
    ).toThrow(message)
    expect(() =>
      loadApiEnv({ SUPABASE_URL: URL, SUPABASE_PUBLISHABLE_KEY: jwtWithRole('service_role') }),
    ).toThrow(message)
  })

  it('refuses a SUPABASE_URL that is not a URL', () => {
    expect(() =>
      loadApiEnv({ SUPABASE_URL: 'localhost', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }),
    ).toThrow()
  })
})
