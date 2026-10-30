import {
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
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
})
