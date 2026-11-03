import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { s3Storage } from './s3'

const ORG = '0193b2a4-5c6d-7e8f-9a0b-1c2d3e4f5a6b'
const config = {
  endpoint: 'https://account.r2.cloudflarestorage.com',
  bucket: 'files',
  region: 'auto',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
}

type Sent = { name: string; input: Record<string, unknown> }

function mockS3(answer: (command: Sent) => unknown) {
  const sent: Sent[] = []
  vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: {
    constructor: { name: string }
    input: Record<string, unknown>
  }) => {
    const call = { name: command.constructor.name, input: command.input }
    sent.push(call)
    return answer(call)
  }) as never)
  return sent
}

afterEach(() => vi.restoreAllMocks())

describe('s3Storage', () => {
  it('validates the folder before listing, and reports what the bucket kept', async () => {
    const sent = mockS3((call) =>
      call.name === ListObjectsV2Command.name
        ? { Contents: [{ Key: `${ORG}/a.pdf` }, { Key: `${ORG}/b.pdf` }] }
        : { Errors: [{ Key: `${ORG}/a.pdf`, Code: 'AccessDenied', Message: 'no' }] },
    )
    const files = s3Storage(config).forOrganization(ORG)

    await expect(files.removePrefix('../escape/')).rejects.toThrow('not a usable folder')
    expect(sent).toHaveLength(0)
    await expect(files.removePrefix('')).rejects.toThrow(
      `[data] the bucket kept 1 of 2 objects, ${ORG}/a.pdf with AccessDenied: no`,
    )
    expect(sent[1]?.name).toBe(DeleteObjectsCommand.name)
  })

  it('deletes in batches of 1000, and sends nothing for an empty folder', async () => {
    let contents = Array.from({ length: 2001 }, (_, i) => ({ Key: `${ORG}/f${i}.txt` }))
    const sent = mockS3((call) =>
      call.name === ListObjectsV2Command.name ? { Contents: contents } : {},
    )
    await s3Storage(config).forOrganization(ORG).removePrefix('')

    const sizes = sent
      .filter((call) => call.name === DeleteObjectsCommand.name)
      .map((call) => (call.input.Delete as { Objects: unknown[] }).Objects.length)
    expect(sizes).toEqual([1000, 1000, 1])

    sent.length = 0
    contents = []
    await s3Storage(config).forOrganization(ORG).removePrefix('')
    expect(sent.map((call) => call.name)).toEqual([ListObjectsV2Command.name])
  })

  it('removes and lists a folder page by page, relative to the organization', async () => {
    const pages = [
      {
        Contents: [{ Key: `${ORG}/c1/a.pdf` }],
        IsTruncated: true,
        NextContinuationToken: 'next',
      },
      { Contents: [{ Key: `${ORG}/c1/sub/b.pdf` }], IsTruncated: false },
    ]
    let page = 0
    const sent = mockS3((call) =>
      call.name === ListObjectsV2Command.name ? pages[page++ % 2] : {},
    )
    const files = s3Storage(config, { listPageSize: 1 }).forOrganization(ORG)

    expect(await files.list('c1/')).toEqual([{ path: 'c1/a.pdf' }, { path: 'c1/sub/b.pdf' }])
    expect(sent[0]?.input).toMatchObject({ Prefix: `${ORG}/c1/`, MaxKeys: 1 })
    expect(sent[1]?.input).toMatchObject({ ContinuationToken: 'next' })

    sent.length = 0
    await files.removePrefix('c1/')
    const deleted = sent.find((call) => call.name === DeleteObjectsCommand.name)
    expect((deleted?.input.Delete as { Objects: { Key: string }[] }).Objects).toEqual([
      { Key: `${ORG}/c1/a.pdf` },
      { Key: `${ORG}/c1/sub/b.pdf` },
    ])
  })

  it('probes the bucket with HeadBucket', async () => {
    const sent = mockS3(() => ({}))
    await s3Storage(config).probe()
    expect(sent[0]).toEqual({ name: HeadBucketCommand.name, input: { Bucket: 'files' } })
  })

  it('presigns an upload bound to the content type and length, and a named download', async () => {
    const files = s3Storage(config).forOrganization(ORG)
    const upload = await files.presignPut('files/1', {
      contentType: 'application/pdf',
      contentLength: 1234,
      expiresInSeconds: 900,
    })
    const put = new URL(upload.url)
    expect(put.origin + put.pathname).toBe(`${config.endpoint}/files/${ORG}/files/1`)
    expect(put.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(put.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(
      expect.arrayContaining(['content-length', 'content-type', 'host']),
    )
    expect(upload.headers).toEqual({ 'content-type': 'application/pdf' })

    const download = await files.presignGet('files/1', {
      downloadName: 'Q3 report.pdf',
      expiresInSeconds: 300,
    })
    const get = new URL(download.url)
    expect(get.searchParams.get('response-content-disposition')).toBe(
      `attachment; filename="Q3 report.pdf"; filename*=UTF-8''Q3%20report.pdf`,
    )
  })

  it('heads an object, undefined when the bucket answers 404', async () => {
    let found = true
    mockS3(() => {
      if (found) return { ContentLength: 7, ContentType: 'text/plain' }
      throw Object.assign(new Error('NotFound'), { $metadata: { httpStatusCode: 404 } })
    })
    const files = s3Storage(config).forOrganization(ORG)
    expect(await files.head('files/1')).toEqual({ size: 7, contentType: 'text/plain' })
    found = false
    expect(await files.head('files/1')).toBeUndefined()
  })

  it('rethrows head failures other than 404', async () => {
    mockS3(() => {
      throw Object.assign(new Error('denied'), { $metadata: { httpStatusCode: 403 } })
    })
    await expect(s3Storage(config).forOrganization(ORG).head('files/1')).rejects.toThrow('denied')
  })

  it('removes one object by its key', async () => {
    const sent = mockS3(() => ({}))
    await s3Storage(config).forOrganization(ORG).remove('files/1')
    expect(sent).toEqual([
      { name: DeleteObjectCommand.name, input: { Bucket: 'files', Key: `${ORG}/files/1` } },
    ])
  })

  it('prepares a local bucket: created only when missing, open to any origin', async () => {
    let exists = false
    const sent = mockS3((call) => {
      if (call.name === HeadBucketCommand.name && !exists) {
        throw Object.assign(new Error('NotFound'), { $metadata: { httpStatusCode: 404 } })
      }
      return {}
    })
    await s3Storage(config).prepareLocalBucket()
    expect(sent.map((call) => call.name)).toEqual([
      HeadBucketCommand.name,
      CreateBucketCommand.name,
      PutBucketCorsCommand.name,
    ])
    expect(sent[2]?.input).toMatchObject({
      CORSConfiguration: { CORSRules: [{ AllowedOrigins: ['*'], AllowedMethods: ['GET', 'PUT'] }] },
    })

    sent.length = 0
    exists = true
    await s3Storage(config).prepareLocalBucket()
    expect(sent.map((call) => call.name)).toEqual([
      HeadBucketCommand.name,
      PutBucketCorsCommand.name,
    ])
  })
})
