import { randomUUID } from 'node:crypto'

import { FILE_POLICIES } from '@arrakit/plans'
import { StorageClient } from '@supabase/storage-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { UPLOAD_URL_SECONDS, objectKey } from './folder'
import { FILES_BUCKET, supabaseStorage } from './supabase'
import type { OrganizationObjects, Storage } from './types'

const { SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY } = process.env
const configured = SUPABASE_URL && SUPABASE_SECRET_KEY && SUPABASE_PUBLISHABLE_KEY

const widestLimit = Math.max(...Object.values(FILE_POLICIES).map((policy) => policy.maxBytes))
const text = (value: string) => new TextEncoder().encode(value)

function filenameOf(disposition: string | null): string | undefined {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? '')?.[1]
  return encoded === undefined ? undefined : decodeURIComponent(encoded)
}

function tokenLifetime(url: string): number {
  const token = new URL(url).searchParams.get('token') ?? ''
  const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
    exp: number
    iat: number
  }
  return payload.exp - payload.iat
}

describe.runIf(configured)('supabaseStorage against the local stack', () => {
  const config = { url: SUPABASE_URL!, secretKey: SUPABASE_SECRET_KEY! }
  // Vitest runs a skipped suite's body too, and the client refuses an undefined URL.
  let storage: Storage
  beforeAll(() => {
    storage = supabaseStorage(config)
  })
  const touched: OrganizationObjects[] = []
  const organization = () => {
    const id = randomUUID()
    const files = storage.forOrganization(id)
    touched.push(files)
    return { id, files }
  }

  afterAll(async () => {
    for (const files of touched) await files.removePrefix('')
    for (const files of touched) expect(await files.list('')).toEqual([])
  })

  it('probes the bucket', async () => {
    await storage.probe()
  })

  it('uploads through a signed link and downloads under the file name', async () => {
    const { files } = organization()
    const bytes = text('# Año final\n')
    const ticket = await files.presignPut('files/1', {
      contentType: 'text/markdown',
    })
    expect(tokenLifetime(ticket.url)).toBe(UPLOAD_URL_SECONDS)

    const first = await fetch(ticket.url, { method: 'PUT', headers: ticket.headers, body: bytes })
    expect(first.status).toBe(200)
    expect(await files.head('files/1')).toEqual({
      size: bytes.byteLength,
      contentType: 'text/markdown',
    })

    const again = await fetch(ticket.url, { method: 'PUT', headers: ticket.headers, body: bytes })
    expect(again.status).toBe(400)
    expect(await again.json()).toMatchObject({ code: 'KeyAlreadyExists' })

    const name = 'Año "final".md'
    const download = await files.presignGet('files/1', {
      downloadName: name,
      expiresInSeconds: 60,
    })
    const got = await fetch(download.url)
    expect(got.status).toBe(200)
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes)
    expect(filenameOf(got.headers.get('content-disposition'))).toBe(name)
  })

  it('lists, removes folders and keeps organizations apart', async () => {
    const { files } = organization()
    const other = organization().files
    const workspace = randomUUID()
    const paths = [
      'files/a.pdf',
      `workspaces/${workspace}/one.txt`,
      `workspaces/${workspace}/sub/two.txt`,
      `workspaces/${workspace}x/sibling.txt`,
    ]
    for (const path of paths) await files.put(path, text(path), 'text/plain')

    expect((await files.list('')).map(({ path }) => path).sort()).toEqual([...paths].sort())
    expect((await files.list(`workspaces/${workspace}/`)).map(({ path }) => path).sort()).toEqual([
      `workspaces/${workspace}/one.txt`,
      `workspaces/${workspace}/sub/two.txt`,
    ])
    expect(await other.list('')).toEqual([])
    expect(await other.head('files/a.pdf')).toBeUndefined()

    await files.removePrefix(`workspaces/${workspace}/`)
    expect((await files.list('')).map(({ path }) => path).sort()).toEqual([
      'files/a.pdf',
      `workspaces/${workspace}x/sibling.txt`,
    ])

    await files.remove('files/a.pdf')
    await files.remove('files/a.pdf')
    expect(await files.head('files/a.pdf')).toBeUndefined()

    await files.removePrefix('')
    expect(await files.list('')).toEqual([])
  })

  it('pages through a listing', async () => {
    const id = randomUUID()
    const files = supabaseStorage(config, { listPageSize: 2 }).forOrganization(id)
    touched.push(files)
    const paths = Array.from({ length: 5 }, (_, i) => `files/${i}.txt`)
    for (const path of paths) await files.put(path, text(path), 'text/plain')

    expect((await files.list('')).map(({ path }) => path).sort()).toEqual(paths)
    await files.removePrefix('')
    expect(await files.list('')).toEqual([])
  })

  it('refuses an upload over the limit or of a type no plan allows', async () => {
    const { files } = organization()
    const tooBig = await files.presignPut('files/big', {
      contentType: 'application/pdf',
    })
    const big = await fetch(tooBig.url, {
      method: 'PUT',
      headers: tooBig.headers,
      body: new Uint8Array(widestLimit + 1),
    })
    expect(big.status).toBe(400)
    expect(await big.json()).toMatchObject({ statusCode: '413' })
    expect(await files.head('files/big')).toBeUndefined()

    const svg = await files.presignPut('files/svg', {
      contentType: 'image/svg+xml',
    })
    const refused = await fetch(svg.url, { method: 'PUT', headers: svg.headers, body: '<svg/>' })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ statusCode: '415' })
    expect(await files.head('files/svg')).toBeUndefined()
  })

  it('denies the publishable key everything', async () => {
    const { id, files } = organization()
    await files.put('files/secret.txt', text('secret'), 'text/plain')
    const key = objectKey(id, 'files/secret.txt')
    const publicBucket = new StorageClient(`${SUPABASE_URL}/storage/v1`, {
      apikey: SUPABASE_PUBLISHABLE_KEY!,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    }).from(FILES_BUCKET)

    expect((await publicBucket.createSignedUploadUrl(objectKey(id, 'files/new'))).error).not.toBe(
      null,
    )
    expect((await publicBucket.createSignedUrl(key, 60)).error).not.toBe(null)
    const listed = await publicBucket.listV2({ prefix: `${id}/` })
    expect(listed.data?.objects ?? []).toEqual([])
    expect(
      (await fetch(`${SUPABASE_URL}/storage/v1/object/public/${FILES_BUCKET}/${key}`)).ok,
    ).toBe(false)
    await expect(
      supabaseStorage({ url: SUPABASE_URL!, secretKey: SUPABASE_PUBLISHABLE_KEY! }).probe(),
    ).rejects.toThrow()
    expect(await files.head('files/secret.txt')).toMatchObject({ size: 6 })
  })
})
