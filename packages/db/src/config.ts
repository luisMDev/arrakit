import type { ConnectionConfig } from './connection'

export interface SupabaseStorageConfig {
  url: string
  secretKey: string
}

export type DataConfig = ConnectionConfig & {
  /** The Supabase Storage bucket; absent (never in production) means in-memory storage. */
  storage?: SupabaseStorageConfig
}

type Env = Record<string, string | undefined>

/**
 * DATABASE_URL is required. SUPABASE_SECRET_KEY turns on Supabase Storage and then requires
 * SUPABASE_URL. Production requires both, so files are never kept in memory there; elsewhere,
 * without the secret key storage is in memory even when SUPABASE_URL is set (Realtime alone uses
 * it). Empty strings count as missing; every missing name is reported in one error
 * `[data] missing env: A, B`.
 */
export function loadDataConfig(env: Env): DataConfig {
  const value = (name: string) => env[name] || undefined
  const production = env.NODE_ENV === 'production'
  const secretKey = value('SUPABASE_SECRET_KEY')
  const url = value('SUPABASE_URL')
  const missing: string[] = []
  if (!value('DATABASE_URL')) missing.push('DATABASE_URL')
  if ((secretKey || production) && !url) missing.push('SUPABASE_URL')
  if (production && !secretKey) missing.push('SUPABASE_SECRET_KEY')
  if (missing.length > 0) throw new Error(`[data] missing env: ${missing.join(', ')}`)

  return {
    databaseUrl: env.DATABASE_URL!,
    storage: secretKey && url ? { url, secretKey } : undefined,
  }
}
