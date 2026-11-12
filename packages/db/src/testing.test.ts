import { describe, expect, it } from 'vitest'

import { stackEnv } from './testing'

const complete = {
  DATABASE_URL: 'postgresql://pooler/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  SUPABASE_SECRET_KEY: 'sb_secret_x',
  BETTER_AUTH_JWT_KEY: '{"kty":"EC"}',
}

describe('stackEnv', () => {
  it('answers the five variables of the stack suite', () => {
    expect(stackEnv({ ...complete, OTHER: 'ignored' })).toEqual(complete)
  })

  it('names every missing or empty variable and how to run the suite', () => {
    const { SUPABASE_URL: _url, ...rest } = complete
    expect(() => stackEnv({ ...rest, SUPABASE_SECRET_KEY: '' })).toThrow(
      '[stack] missing SUPABASE_URL, SUPABASE_SECRET_KEY: run `pnpm test:stack` from the repository root',
    )
  })
})
