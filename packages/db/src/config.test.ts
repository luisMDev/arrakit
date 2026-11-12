import { describe, expect, it } from 'vitest'

import { loadDataConfig } from './config'

const DATABASE = { DATABASE_URL: 'postgres://localhost/arrakit' }

const R2 = {
  ...DATABASE,
  R2_ENDPOINT: 'https://r2.example.com',
  R2_BUCKET: 'arrakit',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
}

describe('loadDataConfig', () => {
  it('reads Postgres, with in-memory storage when no bucket is set', () => {
    expect(loadDataConfig(DATABASE)).toEqual({
      databaseUrl: 'postgres://localhost/arrakit',
      databaseDirectUrl: undefined,
      s3: undefined,
    })
  })

  it('requires the database in every environment', () => {
    expect(() => loadDataConfig({})).toThrow('[data] missing env: DATABASE_URL')
    expect(() => loadDataConfig({ DATABASE_URL: '' })).toThrow('[data] missing env: DATABASE_URL')
    expect(() => loadDataConfig({ NODE_ENV: 'production' })).toThrow(
      '[data] missing env: DATABASE_URL',
    )
  })

  it('reads a direct Postgres URL for sessions, absent unless set', () => {
    expect(
      loadDataConfig({ DATABASE_URL: 'postgres://pooler/a' }).databaseDirectUrl,
    ).toBeUndefined()
    expect(
      loadDataConfig({
        DATABASE_URL: 'postgres://pooler/a',
        DATABASE_DIRECT_URL: 'postgres://db/a',
      }).databaseDirectUrl,
    ).toBe('postgres://db/a')
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

  it('names every missing variable in one error; an empty one counts as missing', () => {
    expect(() => loadDataConfig({ R2_ENDPOINT: 'https://r2', R2_BUCKET: '' })).toThrow(
      '[data] missing env: DATABASE_URL, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY',
    )
  })

  it('takes the bucket all or none in production too', () => {
    const production = { NODE_ENV: 'production', DATABASE_URL: 'postgres://db/a' }
    expect(loadDataConfig(production).s3).toBeUndefined()
    expect(loadDataConfig({ ...production, ...R2 }).s3).toBeDefined()
    expect(() => loadDataConfig({ ...production, R2_BUCKET: 'arrakit' })).toThrow(
      '[data] missing env: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY',
    )
  })
})
