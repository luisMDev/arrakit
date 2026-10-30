import type { ConnectionConfig } from './connection'

export interface S3Config {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export interface DataConfig extends ConnectionConfig {
  /** S3-compatible bucket; absent means the local/in-memory fallback. */
  s3?: S3Config
  /** Local storage fallback directory; absent means in-memory. */
  storageDir?: string
}

type Env = Record<string, string | undefined>

const R2_REQUIRED = [
  'R2_ENDPOINT',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const

/**
 * DATABASE_URL is optional (absent -> PGlite at PGLITE_DIR, default `.data/pglite`). R2_* are
 * all-or-none (absent -> local storage under STORAGE_DIR, default `.data/storage`). In production
 * DATABASE_URL and every R2_* are required. Empty strings count as missing; every missing name
 * is reported in one error `[data] missing env: A, B`.
 */
export function loadDataConfig(env: Env): DataConfig {
  const value = (name: string) => (env[name] ? env[name] : undefined)
  const production = env.NODE_ENV === 'production'
  const missing: string[] = []
  if (production && !value('DATABASE_URL')) missing.push('DATABASE_URL')
  const r2Set = R2_REQUIRED.filter((name) => value(name))
  if (production || r2Set.length > 0) missing.push(...R2_REQUIRED.filter((name) => !value(name)))
  if (missing.length > 0) throw new Error(`[data] missing env: ${missing.join(', ')}`)

  return {
    databaseUrl: value('DATABASE_URL'),
    pgliteDir: value('PGLITE_DIR') ?? '.data/pglite',
    pgliteReset: value('PGLITE_RESET') === '1',
    storageDir: value('STORAGE_DIR') ?? '.data/storage',
    s3:
      r2Set.length > 0
        ? {
            endpoint: env.R2_ENDPOINT!,
            bucket: env.R2_BUCKET!,
            region: value('R2_REGION') ?? 'auto',
            accessKeyId: env.R2_ACCESS_KEY_ID!,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
          }
        : undefined,
  }
}
