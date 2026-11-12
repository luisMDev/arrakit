import { describe, expect, it } from 'vitest'

import { loadDataConfig } from './config'

const DATABASE = { DATABASE_URL: 'postgres://localhost/arrakit' }

const SUPABASE = {
  ...DATABASE,
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SECRET_KEY: 'sb_secret_x',
}

describe('loadDataConfig', () => {
  it('reads Postgres, with in-memory storage when no secret key is set', () => {
    expect(loadDataConfig(DATABASE)).toEqual({
      databaseUrl: 'postgres://localhost/arrakit',
      storage: undefined,
    })
    expect(loadDataConfig({ ...DATABASE, SUPABASE_URL: SUPABASE.SUPABASE_URL }).storage).toBe(
      undefined,
    )
  })

  it('requires the database in every environment', () => {
    expect(() => loadDataConfig({})).toThrow('[data] missing env: DATABASE_URL')
    expect(() => loadDataConfig({ DATABASE_URL: '' })).toThrow('[data] missing env: DATABASE_URL')
    expect(() => loadDataConfig({ NODE_ENV: 'production' })).toThrow(
      '[data] missing env: DATABASE_URL',
    )
  })

  it('reads Supabase Storage when the secret key and the URL are set', () => {
    expect(loadDataConfig(SUPABASE).storage).toEqual({
      url: SUPABASE.SUPABASE_URL,
      secretKey: SUPABASE.SUPABASE_SECRET_KEY,
    })
  })

  it('names every missing variable in one error; an empty one counts as missing', () => {
    expect(() => loadDataConfig({ SUPABASE_SECRET_KEY: 'sb_secret_x', SUPABASE_URL: '' })).toThrow(
      '[data] missing env: DATABASE_URL, SUPABASE_URL',
    )
  })

  it('treats storage the same way in production', () => {
    const production = { NODE_ENV: 'production', DATABASE_URL: 'postgres://db/a' }
    expect(loadDataConfig(production).storage).toBeUndefined()
    expect(loadDataConfig({ ...production, SUPABASE_URL: 'https://x.supabase.co' }).storage).toBe(
      undefined,
    )
    expect(loadDataConfig({ ...SUPABASE, ...production }).storage).toBeDefined()
    expect(() => loadDataConfig({ ...production, SUPABASE_SECRET_KEY: 'sb_secret_x' })).toThrow(
      '[data] missing env: SUPABASE_URL',
    )
  })
})
