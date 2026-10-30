import {
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'

import type { S3Config } from '../config'
import { folderPrefix } from './folder'
import type { OrganizationFiles, Storage } from './types'

export function s3Storage(config: S3Config, options: { listPageSize?: number } = {}): Storage {
  const listPageSize = options.listPageSize ?? 1000
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  const Bucket = config.bucket

  async function listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = []
    let token: string | undefined
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket,
          Prefix: prefix,
          MaxKeys: listPageSize,
          ContinuationToken: token,
        }),
      )
      for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key)
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
    return keys
  }

  async function deleteKeys(keys: string[]) {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000)
      const result = await client.send(
        new DeleteObjectsCommand({
          Bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      )
      const first = result.Errors?.[0]
      if (first) {
        throw new Error(
          `[data] the bucket kept ${result.Errors!.length} of ${batch.length} objects, ${first.Key} with ${first.Code}: ${first.Message}`,
        )
      }
    }
  }

  const forOrganization = (organizationId: string): OrganizationFiles => {
    const orgPrefix = folderPrefix(organizationId, '')
    return {
      async removePrefix(folder) {
        await deleteKeys(await listKeys(folderPrefix(organizationId, folder)))
      },
      async list(folder) {
        const keys = await listKeys(folderPrefix(organizationId, folder))
        return keys.map((key) => ({ path: key.slice(orgPrefix.length) }))
      },
    }
  }

  return {
    kind: 's3',
    forOrganization,
    async probe(signal) {
      await client.send(new HeadBucketCommand({ Bucket }), { abortSignal: signal })
    },
    async close() {
      client.destroy()
    },
  }
}
