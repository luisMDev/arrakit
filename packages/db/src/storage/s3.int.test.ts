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
  const storage = () =>
    s3Storage({
      endpoint: env.S3_TEST_ENDPOINT!,
      bucket: env.S3_TEST_BUCKET!,
      region: env.S3_TEST_REGION ?? 'auto',
      accessKeyId: env.S3_TEST_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_TEST_SECRET_ACCESS_KEY!,
    })
  const org = randomUUID()

  it('uploads through a presigned PUT and reads it back, type kept on copy', async () => {
    const files = storage().forOrganization(org)
    const put = await fetch(await files.putUrl('a/doc.pdf', { contentType: 'application/pdf' }), {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf' },
      body: '%PDF',
    })
    expect(put.status).toBe(200)
    await files.copy('a/doc.pdf', 'a/copy.pdf')
    const got = await fetch(await files.getUrl('a/copy.pdf'))
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('application/pdf')
    expect(await got.text()).toBe('%PDF')
    await files.removePrefix('')
  })

  it('refuses unsigned and expired access with 403', async () => {
    const files = storage().forOrganization(org)
    await files.put('b.txt', new TextEncoder().encode('b'), 'text/plain')
    const url = new URL(await files.getUrl('b.txt', { expiresIn: 1 }))
    expect((await fetch(`${url.origin}${url.pathname}`)).status).toBe(403)
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    expect((await fetch(url)).status).toBe(403)
    await files.removePrefix('')
  }, 20_000)
})
