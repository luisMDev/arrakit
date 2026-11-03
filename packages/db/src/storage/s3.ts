import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  paginateListObjectsV2,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import type { S3Config } from '../config'
import { attachmentDisposition, expiryIn, folderPrefix, objectKey } from './folder'
import type { OrganizationObjects, Storage } from './types'

const isNotFound = (err: unknown) =>
  (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404

export interface S3Storage extends Storage {
  prepareLocalBucket(): Promise<void>
}

export function s3Storage(config: S3Config, options: { listPageSize?: number } = {}): S3Storage {
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
    const pages = paginateListObjectsV2(
      { client, pageSize: listPageSize },
      { Bucket, Prefix: prefix },
    )
    for await (const page of pages) {
      for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key)
    }
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

  const forOrganization = (organizationId: string): OrganizationObjects => {
    const orgPrefix = folderPrefix(organizationId, '')
    const keyOf = (path: string) => objectKey(organizationId, path)
    return {
      async removePrefix(folder) {
        await deleteKeys(await listKeys(folderPrefix(organizationId, folder)))
      },
      async list(folder) {
        const keys = await listKeys(folderPrefix(organizationId, folder))
        return keys.map((key) => ({ path: key.slice(orgPrefix.length) }))
      },
      async presignPut(path, { contentType, contentLength, expiresInSeconds }) {
        const command = new PutObjectCommand({
          Bucket,
          Key: keyOf(path),
          ContentType: contentType,
          ContentLength: contentLength,
        })
        const url = await getSignedUrl(client, command, {
          expiresIn: expiresInSeconds,
          signableHeaders: new Set(['content-type', 'content-length']),
        })
        return {
          url,
          headers: { 'content-type': contentType },
          expiresAt: expiryIn(expiresInSeconds),
        }
      },
      async presignGet(path, { downloadName, expiresInSeconds }) {
        const command = new GetObjectCommand({
          Bucket,
          Key: keyOf(path),
          ResponseContentDisposition: attachmentDisposition(downloadName),
        })
        const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds })
        return { url, expiresAt: expiryIn(expiresInSeconds) }
      },
      async head(path) {
        try {
          const found = await client.send(new HeadObjectCommand({ Bucket, Key: keyOf(path) }))
          return {
            size: found.ContentLength ?? 0,
            contentType: found.ContentType ?? 'application/octet-stream',
          }
        } catch (err) {
          if (isNotFound(err)) return undefined
          throw err
        }
      },
      async put(path, bytes, contentType) {
        await client.send(
          new PutObjectCommand({ Bucket, Key: keyOf(path), Body: bytes, ContentType: contentType }),
        )
      },
      async remove(path) {
        await client.send(new DeleteObjectCommand({ Bucket, Key: keyOf(path) }))
      },
    }
  }

  /**
   * Local S3 only (dev and e2e start with no bucket): creates the bucket when missing and lets
   * any origin upload and download through presigned URLs.
   */
  async function prepareLocalBucket() {
    try {
      await client.send(new HeadBucketCommand({ Bucket }))
    } catch (err) {
      if (!isNotFound(err)) throw err
      await client.send(new CreateBucketCommand({ Bucket }))
    }
    await client.send(
      new PutBucketCorsCommand({
        Bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: ['*'],
              AllowedMethods: ['GET', 'PUT'],
              AllowedHeaders: ['*'],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    )
  }

  return {
    forOrganization,
    prepareLocalBucket,
    async probe(signal) {
      await client.send(new HeadBucketCommand({ Bucket }), { abortSignal: signal })
    },
    async close() {
      client.destroy()
    },
  }
}
