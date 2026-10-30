import { pathToFileURL } from 'node:url'

import { loadDataConfig, putBucketCors, r2CorsPolicy } from '@arrakit/db'

import { loadApiEnv } from '../src/env'

/**
 * `pnpm --filter @arrakit/api bucket:cors [--print]`: lets the web origin use presigned URLs
 * against the R2/S3 bucket. `--print` writes the R2 policy JSON (for `wrangler r2 bucket cors set`)
 * instead of applying it, which needs credentials allowed to change bucket settings.
 */
export async function bucketCors(
  env: Record<string, string | undefined>,
  args: readonly string[],
  apply: typeof putBucketCors = putBucketCors,
): Promise<string> {
  const origins = [loadApiEnv(env).webUrl]
  if (args.includes('--print')) return `${JSON.stringify(r2CorsPolicy(origins), null, 2)}\n`
  const s3 = loadDataConfig(env).s3
  if (!s3) throw new Error('Set R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.')
  await apply(s3, origins)
  return `bucket ${s3.bucket} now answers ${origins.join(', ')}\n`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  bucketCors(process.env, process.argv.slice(2))
    .then((output) => process.stdout.write(output))
    .catch((error: unknown) => {
      console.error(error)
      process.exit(1)
    })
}
