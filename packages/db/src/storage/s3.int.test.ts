import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { s3Storage } from './s3'

/**
 * Against a real S3-compatible bucket (MinIO, R2). Runs only when S3_TEST_ENDPOINT, S3_TEST_BUCKET,
 * S3_TEST_ACCESS_KEY_ID and S3_TEST_SECRET_ACCESS_KEY are set (optional S3_TEST_REGION); skipped
 * otherwise. Unit coverage of the client calls lives in s3.test.ts.
 */
const env = process.env
const configured =
  env.S3_TEST_ENDPOINT &&
  env.S3_TEST_BUCKET &&
  env.S3_TEST_ACCESS_KEY_ID &&
  env.S3_TEST_SECRET_ACCESS_KEY

describe.runIf(configured)('s3Storage against a real bucket', () => {
  it('probes the bucket and lists then removes an empty organization', async () => {
    const storage = s3Storage({
      endpoint: env.S3_TEST_ENDPOINT!,
      bucket: env.S3_TEST_BUCKET!,
      region: env.S3_TEST_REGION ?? 'auto',
      accessKeyId: env.S3_TEST_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_TEST_SECRET_ACCESS_KEY!,
    })
    await storage.probe()
    const files = storage.forOrganization(randomUUID())
    expect(await files.list('')).toEqual([])
    await files.removePrefix('')
  })
})
