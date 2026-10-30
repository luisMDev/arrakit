import { readFileSync } from 'node:fs'

import { S3Client } from '@aws-sdk/client-s3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BUCKET_CORS, putBucketCors, r2CorsPolicy, s3CorsRules } from './bucket-cors'

const config = {
  endpoint: 'https://account.r2.cloudflarestorage.com',
  bucket: 'files',
  region: 'auto',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
}

afterEach(() => vi.restoreAllMocks())

describe('bucket CORS for direct browser uploads', () => {
  it('lets the web origin PUT and GET with content-type, preflight cached an hour', () => {
    expect(r2CorsPolicy(['https://app.example.com'])).toEqual({
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

  it('matches the r2-cors.json shipped next to it', () => {
    const shipped = JSON.parse(readFileSync(new URL('./r2-cors.json', import.meta.url), 'utf8'))
    expect(shipped).toEqual(r2CorsPolicy(shipped.rules[0].allowed.origins))
  })

  it('writes the same policy in S3 PutBucketCors form', () => {
    expect(s3CorsRules(['https://app.example.com', 'http://localhost:4200/'])).toEqual([
      {
        AllowedOrigins: ['https://app.example.com', 'http://localhost:4200'],
        AllowedMethods: ['PUT', 'GET'],
        AllowedHeaders: ['content-type'],
        MaxAgeSeconds: BUCKET_CORS.maxAgeSeconds,
      },
    ])
  })

  it('refuses no origin, a path, or something that is not a URL', () => {
    expect(() => r2CorsPolicy([])).toThrow(/at least one web origin/)
    expect(() => r2CorsPolicy(['https://app.example.com/app'])).toThrow(/not a web origin/)
    expect(() => r2CorsPolicy(['app.example.com'])).toThrow(/not a web origin/)
  })

  it('puts the rules on the configured bucket', async () => {
    const sent: { name: string; input: unknown }[] = []
    vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: {
      constructor: { name: string }
      input: unknown
    }) => {
      sent.push({ name: command.constructor.name, input: command.input })
      return {}
    }) as never)
    await putBucketCors(config, ['https://app.example.com'])
    expect(sent).toEqual([
      {
        name: 'PutBucketCorsCommand',
        input: {
          Bucket: 'files',
          CORSConfiguration: { CORSRules: s3CorsRules(['https://app.example.com']) },
        },
      },
    ])
  })
})
