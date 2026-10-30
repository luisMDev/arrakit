import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import type { S3Config } from '../config'
import { FileNotFoundError } from '../errors'
import { toFileKey, toFolderPrefix } from './file-key'
import type { OrganizationFiles, Storage, StoredFile } from './types'

const isNotFound = (err: unknown) =>
  err instanceof NoSuchKey ||
  (err as { name?: string }).name === 'NoSuchKey' ||
  (err as { name?: string }).name === 'NotFound'

export function s3Storage(config: S3Config, options: { listPageSize?: number } = {}): Storage {
  const listPageSize = options.listPageSize ?? 1000
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
    // Otherwise presigned PUTs carry an empty-body CRC32 and R2 rejects uploads.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  const Bucket = config.bucket

  async function listKeys(
    prefix: string,
  ): Promise<{ key: string; size: number; modifiedAt: Date }[]> {
    const keys: { key: string; size: number; modifiedAt: Date }[] = []
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
      for (const object of page.Contents ?? []) {
        if (object.Key) {
          keys.push({
            key: object.Key,
            size: object.Size ?? 0,
            modifiedAt: object.LastModified ?? new Date(0),
          })
        }
      }
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
    const orgPrefix = toFolderPrefix(organizationId, '')
    return {
      async putUrl(name, opts = {}) {
        return getSignedUrl(
          client,
          new PutObjectCommand({
            Bucket,
            Key: toFileKey(organizationId, name),
            ContentType: opts.contentType,
          }),
          { expiresIn: opts.expiresIn ?? 900 },
        )
      },
      async put(name, bytes, contentType) {
        await client.send(
          new PutObjectCommand({
            Bucket,
            Key: toFileKey(organizationId, name),
            Body: bytes,
            ContentType: contentType,
          }),
        )
      },
      async get(name) {
        try {
          const object = await client.send(
            new GetObjectCommand({ Bucket, Key: toFileKey(organizationId, name) }),
          )
          return await object.Body!.transformToByteArray()
        } catch (err) {
          if (isNotFound(err)) throw new FileNotFoundError(name)
          throw err
        }
      },
      async copy(from, to) {
        const source = `${Bucket}/${toFileKey(organizationId, from).split('/').map(encodeURIComponent).join('/')}`
        try {
          await client.send(
            new CopyObjectCommand({
              Bucket,
              Key: toFileKey(organizationId, to),
              CopySource: source,
            }),
          )
        } catch (err) {
          if (isNotFound(err)) throw new FileNotFoundError(from)
          throw err
        }
      },
      async getUrl(name, opts = {}) {
        return getSignedUrl(
          client,
          new GetObjectCommand({ Bucket, Key: toFileKey(organizationId, name) }),
          {
            expiresIn: opts.expiresIn ?? 900,
          },
        )
      },
      async remove(names) {
        const keys = names.map((name) => toFileKey(organizationId, name))
        if (keys.length > 0) await deleteKeys(keys)
      },
      async removePrefix(folder) {
        const keys = await listKeys(toFolderPrefix(organizationId, folder))
        if (keys.length > 0) await deleteKeys(keys.map((k) => k.key))
      },
      async list(folder) {
        const keys = await listKeys(toFolderPrefix(organizationId, folder))
        return keys.map((k): StoredFile => ({
          path: k.key.slice(orgPrefix.length),
          size: k.size,
          modifiedAt: k.modifiedAt.toISOString(),
        }))
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
