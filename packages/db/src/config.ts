import type { ConnectionConfig } from './connection'

export interface S3Config {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** Create the bucket on boot, open to any origin (`R2_LOCAL_BUCKET=1`, local S3 only). */
  localBucket?: boolean
}

export interface DataConfig extends ConnectionConfig {
  /** S3-compatible bucket; absent means in-memory storage. */
  s3?: S3Config
}

type Env = Record<string, string | undefined>

const R2_REQUIRED = [
  'R2_ENDPOINT',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const

/**
 * DATABASE_URL is required. R2_* are all-or-none, in production too (absent -> in-memory
 * storage). Empty strings count as missing; every missing name is reported in one error
 * `[data] missing env: A, B`.
 */
export function loadDataConfig(env: Env): DataConfig {
  const value = (name: string) => env[name] || undefined
  const missing: string[] = []
  if (!value('DATABASE_URL')) missing.push('DATABASE_URL')
  const r2Set = R2_REQUIRED.filter((name) => value(name))
  if (r2Set.length > 0) missing.push(...R2_REQUIRED.filter((name) => !value(name)))
  if (missing.length > 0) throw new Error(`[data] missing env: ${missing.join(', ')}`)

  return {
    databaseUrl: env.DATABASE_URL!,
    s3:
      r2Set.length > 0
        ? {
            endpoint: env.R2_ENDPOINT!,
            bucket: env.R2_BUCKET!,
            region: value('R2_REGION') ?? 'auto',
            accessKeyId: env.R2_ACCESS_KEY_ID!,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
            localBucket: value('R2_LOCAL_BUCKET') === '1',
          }
        : undefined,
  }
}
