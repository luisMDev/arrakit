import { type CORSRule, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3'

import type { S3Config } from '../config'

/**
 * What the browser needs to use presigned URLs directly against the bucket: PUT to upload, GET
 * to download, the `content-type` header the presigned PUT is signed with, preflight cached 1 h.
 */
export const BUCKET_CORS = {
  methods: ['PUT', 'GET'],
  headers: ['content-type'],
  maxAgeSeconds: 3600,
} as const

/** The web origins (scheme, host, port; no path) the bucket answers. */
export function corsOrigins(origins: readonly string[]): string[] {
  if (origins.length === 0) throw new Error('[data] bucket CORS needs at least one web origin')
  return origins.map((origin) => {
    let parsed: URL
    try {
      parsed = new URL(origin)
    } catch {
      throw new Error(`[data] ${origin} is not a web origin`)
    }
    if (parsed.origin !== origin.replace(/\/$/, '')) {
      throw new Error(`[data] ${origin} is not a web origin (no path, query or credentials)`)
    }
    return parsed.origin
  })
}

/**
 * The bucket CORS policy in Cloudflare's R2 format, for
 * `wrangler r2 bucket cors set <bucket> --file <file>`.
 */
export function r2CorsPolicy(origins: readonly string[]) {
  return {
    rules: [
      {
        allowed: {
          origins: corsOrigins(origins),
          methods: [...BUCKET_CORS.methods],
          headers: [...BUCKET_CORS.headers],
        },
        maxAgeSeconds: BUCKET_CORS.maxAgeSeconds,
      },
    ],
  }
}

/** The same policy as S3 `PutBucketCors` rules (also accepted by R2's S3 API). */
export function s3CorsRules(origins: readonly string[]): CORSRule[] {
  return [
    {
      AllowedOrigins: corsOrigins(origins),
      AllowedMethods: [...BUCKET_CORS.methods],
      AllowedHeaders: [...BUCKET_CORS.headers],
      MaxAgeSeconds: BUCKET_CORS.maxAgeSeconds,
    },
  ]
}

/**
 * Replaces the bucket's CORS configuration with the policy for `origins`. Needs credentials
 * allowed to change bucket settings (an R2 admin token), not just object read/write.
 */
export async function putBucketCors(config: S3Config, origins: readonly string[]): Promise<void> {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
  })
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: config.bucket,
        CORSConfiguration: { CORSRules: s3CorsRules(origins) },
      }),
    )
  } finally {
    client.destroy()
  }
}
