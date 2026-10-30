import { describe, expect, it, vi } from 'vitest'

import { bucketCors } from './bucket-cors'

const r2 = {
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  R2_BUCKET: 'files',
  R2_ACCESS_KEY_ID: 'id',
  R2_SECRET_ACCESS_KEY: 'secret',
}

describe('bucket:cors', () => {
  it('prints the R2 policy for the web origin', async () => {
    const output = await bucketCors({ WEB_URL: 'https://app.example.com/' }, ['--print'])
    expect(JSON.parse(output)).toEqual({
      rules: [
        {
          allowed: {
            origins: ['https://app.example.com'],
            methods: ['PUT', 'GET'],
            headers: ['content-type'],
          },
          maxAgeSeconds: 3600,
        },
      ],
    })
  })

  it('applies the policy to the configured bucket', async () => {
    const apply = vi.fn(async () => {})
    await bucketCors({ ...r2, WEB_URL: 'https://app.example.com' }, [], apply)
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'files' }), [
      'https://app.example.com',
    ])
  })

  it('refuses to apply without a bucket', async () => {
    await expect(bucketCors({}, [], vi.fn())).rejects.toThrow(/R2_BUCKET/)
  })
})
