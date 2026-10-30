import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  NoSuchKey,
  S3Client,
} from '@aws-sdk/client-s3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FileNotFoundError } from '../errors'
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
  it('turns a missing key into FileNotFoundError and rethrows anything else', async () => {
    mockS3((call) => {
      const key = call.input.Key as string
      if (key.endsWith('missing.pdf')) {
        throw new NoSuchKey({ message: 'gone', $metadata: {} })
      }
      throw new Error('bucket on fire')
    })
    const files = s3Storage(config).forOrganization(ORG)

    await expect(files.get('missing.pdf')).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(files.get('other.pdf')).rejects.toThrow('bucket on fire')
  })

  it('copies inside the bucket with each key segment URL-encoded', async () => {
    const sent = mockS3(() => ({}))
    await s3Storage(config).forOrganization(ORG).copy('a b/ñ#1.pdf', 'copy.pdf')

    expect(sent[0]?.name).toBe(CopyObjectCommand.name)
    expect(sent[0]?.input).toMatchObject({
      Bucket: 'files',
      Key: `${ORG}/copy.pdf`,
      CopySource: `files/${ORG}/a%20b/%C3%B1%231.pdf`,
    })
  })

  it('validates every name before deleting, and reports what the bucket kept', async () => {
    const sent = mockS3(() => ({
      Errors: [{ Key: `${ORG}/a.pdf`, Code: 'AccessDenied', Message: 'no' }],
    }))
    const files = s3Storage(config).forOrganization(ORG)

    await expect(files.remove(['ok.pdf', '../escape'])).rejects.toThrow('not a usable file name')
    expect(sent).toHaveLength(0)
    await expect(files.remove(['a.pdf', 'b.pdf'])).rejects.toThrow(
      `[data] the bucket kept 1 of 2 objects, ${ORG}/a.pdf with AccessDenied: no`,
    )
    expect(sent[0]?.name).toBe(DeleteObjectsCommand.name)
  })

  it('deletes in batches of 1000', async () => {
    const sent = mockS3(() => ({}))
    const names = Array.from({ length: 2001 }, (_, i) => `f${i}.txt`)
    await s3Storage(config).forOrganization(ORG).remove(names)

    const sizes = sent.map((call) => (call.input.Delete as { Objects: unknown[] }).Objects.length)
    expect(sizes).toEqual([1000, 1000, 1])
  })

  it('removes and lists a folder page by page, relative to the organization', async () => {
    const pages = [
      {
        Contents: [{ Key: `${ORG}/c1/a.pdf`, Size: 3, LastModified: new Date('2027-01-02') }],
        IsTruncated: true,
        NextContinuationToken: 'next',
      },
      { Contents: [{ Key: `${ORG}/c1/sub/b.pdf`, Size: 5 }], IsTruncated: false },
    ]
    let page = 0
    const sent = mockS3((call) =>
      call.name === ListObjectsV2Command.name ? pages[page++ % 2] : {},
    )
    const files = s3Storage(config, { listPageSize: 1 }).forOrganization(ORG)

    expect(await files.list('c1/')).toEqual([
      { path: 'c1/a.pdf', size: 3, modifiedAt: '2027-01-02T00:00:00.000Z' },
      { path: 'c1/sub/b.pdf', size: 5, modifiedAt: new Date(0).toISOString() },
    ])
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

  it('presigns uploads and downloads for the organization key without sending a request', async () => {
    const sent = mockS3(() => ({}))
    const files = s3Storage(config).forOrganization(ORG)

    const put = new URL(await files.putUrl('r.pdf', { contentType: 'application/pdf' }))
    const get = new URL(await files.getUrl('r.pdf', { expiresIn: 60 }))
    expect(put.pathname).toBe(`/files/${ORG}/r.pdf`)
    expect(put.searchParams.get('X-Amz-Expires')).toBe('900')
    expect([...put.searchParams.keys()].some((k) => k.toLowerCase().includes('checksum'))).toBe(
      false,
    )
    expect(get.searchParams.get('X-Amz-Expires')).toBe('60')
    expect(sent).toHaveLength(0)
  })

  it('probes the bucket with HeadBucket', async () => {
    const sent = mockS3(() => ({}))
    await s3Storage(config).probe()
    expect(sent[0]).toEqual({ name: HeadBucketCommand.name, input: { Bucket: 'files' } })
  })
})
