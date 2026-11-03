import { describe, expect, it } from 'vitest'

import { loadDataConfig } from './config'

const R2 = {
  R2_ENDPOINT: 'https://r2.example.com',
  R2_BUCKET: 'arrakit',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
}

describe('loadDataConfig', () => {
  it('falls back to PGlite and in-memory storage in development', () => {
    expect(loadDataConfig({})).toEqual({
      databaseUrl: undefined,
      pgliteDir: '.data/pglite',
      pgliteReset: false,
      s3: undefined,
    })
  })

  it('reads Postgres and a PGlite dir', () => {
    const config = loadDataConfig({
      DATABASE_URL: 'postgres://localhost/arrakit',
      PGLITE_DIR: '/tmp/pg',
      PGLITE_RESET: '1',
    })
    expect(config).toMatchObject({
      databaseUrl: 'postgres://localhost/arrakit',
      pgliteDir: '/tmp/pg',
      pgliteReset: true,
    })
  })

  it('reads a complete R2 set, region defaulting to auto', () => {
    expect(loadDataConfig(R2).s3).toEqual({
      endpoint: R2.R2_ENDPOINT,
      bucket: R2.R2_BUCKET,
      region: 'auto',
      accessKeyId: R2.R2_ACCESS_KEY_ID,
      secretAccessKey: R2.R2_SECRET_ACCESS_KEY,
      localBucket: false,
    })
    expect(loadDataConfig({ ...R2, R2_REGION: 'eu' }).s3?.region).toBe('eu')
    expect(loadDataConfig({ ...R2, R2_LOCAL_BUCKET: '1' }).s3?.localBucket).toBe(true)
  })

  it('names every missing R2 variable of a partial set in one error; empty counts as missing', () => {
    expect(() => loadDataConfig({ R2_ENDPOINT: 'https://r2', R2_BUCKET: '' })).toThrow(
      '[data] missing env: R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY',
    )
  })

  it('requires the database in production, and the bucket only all or none', () => {
    expect(() => loadDataConfig({ NODE_ENV: 'production' })).toThrow(
      '[data] missing env: DATABASE_URL',
    )
    const production = { NODE_ENV: 'production', DATABASE_URL: 'postgres://db/a' }
    expect(loadDataConfig(production).s3).toBeUndefined()
    expect(loadDataConfig({ ...production, ...R2 }).s3).toBeDefined()
    expect(() => loadDataConfig({ ...production, R2_BUCKET: 'arrakit' })).toThrow(
      '[data] missing env: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY',
    )
  })
})
