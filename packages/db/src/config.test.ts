import { describe, expect, it } from 'vitest'

import { loadDataConfig } from './config'

const R2 = {
  R2_ENDPOINT: 'https://r2.example.com',
  R2_BUCKET: 'arrakit',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
}

describe('loadDataConfig', () => {
  it('falls back to PGlite and local storage in development', () => {
    expect(loadDataConfig({})).toEqual({
      databaseUrl: undefined,
      pgliteDir: '.data/pglite',
      pgliteReset: false,
      storageDir: '.data/storage',
      s3: undefined,
    })
  })

  it('reads Postgres, a PGlite dir and a storage dir', () => {
    const config = loadDataConfig({
      DATABASE_URL: 'postgres://localhost/arrakit',
      PGLITE_DIR: '/tmp/pg',
      PGLITE_RESET: '1',
      STORAGE_DIR: '/tmp/files',
    })
    expect(config).toMatchObject({
      databaseUrl: 'postgres://localhost/arrakit',
      pgliteDir: '/tmp/pg',
      pgliteReset: true,
      storageDir: '/tmp/files',
    })
  })

  it('reads a complete R2 set, region defaulting to auto', () => {
    expect(loadDataConfig(R2).s3).toEqual({
      endpoint: R2.R2_ENDPOINT,
      bucket: R2.R2_BUCKET,
      region: 'auto',
      accessKeyId: R2.R2_ACCESS_KEY_ID,
      secretAccessKey: R2.R2_SECRET_ACCESS_KEY,
    })
    expect(loadDataConfig({ ...R2, R2_REGION: 'eu' }).s3?.region).toBe('eu')
  })

  it('names every missing R2 variable of a partial set in one error; empty counts as missing', () => {
    expect(() => loadDataConfig({ R2_ENDPOINT: 'https://r2', R2_BUCKET: '' })).toThrow(
      '[data] missing env: R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY',
    )
  })

  it('requires the database and the bucket in production', () => {
    expect(() => loadDataConfig({ NODE_ENV: 'production' })).toThrow(
      '[data] missing env: DATABASE_URL, R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY',
    )
    expect(
      loadDataConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://db/a', ...R2 }).s3,
    ).toBeDefined()
  })

  it('signs local storage URLs with a secret derived from BETTER_AUTH_SECRET, at the web origin', () => {
    const config = loadDataConfig({
      BETTER_AUTH_SECRET: 'x'.repeat(40),
      BETTER_AUTH_URL: 'http://localhost:4200/path',
    })
    expect(config.storageSigning?.baseUrl).toBe('http://localhost:4200')
    expect(config.storageSigning?.secret).toMatch(/^[\w-]{43}$/)
    expect(config.storageSigning?.secret).not.toContain('x'.repeat(40))
    expect(loadDataConfig({}).storageSigning).toBeUndefined()
  })
})
