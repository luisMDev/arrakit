import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FileNotFoundError } from '../errors'
import { localStorage } from './local'
import { memoryStorage } from './memory'
import type { UrlSigning } from './signed-url'
import type { Storage } from './types'

const ORG_A = '0f8fad5b-d9cb-469f-a165-70867728950e'
const ORG_B = '01890a5d-ac96-774b-bcce-b302099a8057'
const text = (value: string) => new TextEncoder().encode(value)
const read = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'arrakit-storage-'))
})
afterAll(() => rm(dir, { recursive: true, force: true }))

describe.each([
  ['memory', () => memoryStorage()],
  ['local', () => localStorage(join(dir, String(Math.random())))],
] as const)('%s storage', (_kind, make: () => Storage) => {
  let storage: Storage
  beforeAll(() => {
    storage = make()
  })

  const a = () => storage.forOrganization(ORG_A)
  const b = () => storage.forOrganization(ORG_B)

  it('stores and reads bytes, a fresh copy each time', async () => {
    await a().put('notes/a.txt', text('hello'), 'text/plain')
    const first = await a().get('notes/a.txt')
    expect(read(first)).toBe('hello')
    first[0] = 0
    expect(read(await a().get('notes/a.txt'))).toBe('hello')
  })

  it('keeps organizations apart', async () => {
    await a().put('shared.txt', text('a'), 'text/plain')
    await expect(b().get('shared.txt')).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(b().get('shared.txt')).rejects.toThrow('[data] no file stored under "shared.txt"')
    await b().remove(['shared.txt'])
    expect(read(await a().get('shared.txt'))).toBe('a')
  })

  it('copies inside the organization, names needing encoding included', async () => {
    await a().put('src/año 2026 #1.txt', text('copy me'), 'text/plain')
    await a().copy('src/año 2026 #1.txt', 'dst/año 2026 #1.txt')
    expect(read(await a().get('dst/año 2026 #1.txt'))).toBe('copy me')
    await expect(a().copy('missing.txt', 'x.txt')).rejects.toBeInstanceOf(FileNotFoundError)
  })

  it('removes names (missing ones are fine) and validates them all first', async () => {
    await a().put('r/one.txt', text('1'), 'text/plain')
    await a().put('r/two.txt', text('2'), 'text/plain')
    await expect(a().remove(['r/one.txt', '../escape'])).rejects.toThrow('not a usable file name')
    expect(read(await a().get('r/one.txt'))).toBe('1')
    await a().remove(['r/one.txt', 'r/never.txt'])
    await expect(a().get('r/one.txt')).rejects.toBeInstanceOf(FileNotFoundError)
    expect(read(await a().get('r/two.txt'))).toBe('2')
  })

  it('removes a folder but not a sibling sharing its prefix', async () => {
    await a().put('companies/c1/a.pdf', text('a'), 'application/pdf')
    await a().put('companies/c1/deep/b.pdf', text('b'), 'application/pdf')
    await a().put('companies/c1x/c.pdf', text('c'), 'application/pdf')
    await a().removePrefix('companies/c1/')
    expect((await a().list('companies/')).map((f) => f.path)).toEqual(['companies/c1x/c.pdf'])
    await a().removePrefix('empty/')
  })

  it('lists paths relative to the organization, subfolders included, in key order', async () => {
    await b().put('l/z.txt', text('zz'), 'text/plain')
    await b().put('l/a/b.txt', text('b'), 'text/plain')
    const listed = await b().list('l/')
    expect(listed.map((f) => [f.path, f.size])).toEqual([
      ['l/a/b.txt', 1],
      ['l/z.txt', 2],
    ])
    expect(new Date(listed[0]!.modifiedAt).toISOString()).toBe(listed[0]!.modifiedAt)
    expect(await b().list('nothing/')).toEqual([])
  })

  it('refuses unusable names before touching storage', async () => {
    await expect(a().put('../x', text('x'), 'text/plain')).rejects.toThrow('not a usable file name')
    expect(() => storage.forOrganization('not-an-org')).toThrow('[data] not an organization id')
  })

  it('probes healthy', async () => {
    await expect(storage.probe()).resolves.toBeUndefined()
  })
})

describe.each([
  ['memory', (signing: UrlSigning) => memoryStorage({ signing })],
  ['local', (signing: UrlSigning) => localStorage(join(dir, String(Math.random())), { signing })],
] as const)('%s storage presigned URLs', (_kind, make: (signing: UrlSigning) => Storage) => {
  let clock = new Date('2026-01-01T00:00:00Z')
  const signing: UrlSigning = {
    secret: 'test-secret',
    baseUrl: 'http://localhost:5200/',
    now: () => clock,
  }
  let storage: Storage
  beforeAll(() => {
    storage = make(signing)
  })
  const a = () => storage.forOrganization(ORG_A)
  const serve = (url: string, init?: RequestInit) => storage.serveSigned!(new Request(url, init))

  it('keeps the content type a file was put with, on read and on copy', async () => {
    await a().put('typed/doc.pdf', text('%PDF'), 'application/pdf')
    await a().copy('typed/doc.pdf', 'typed/copy.pdf')
    for (const name of ['typed/doc.pdf', 'typed/copy.pdf']) {
      const res = await serve(await a().getUrl(name))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/pdf')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('content-security-policy')).toContain('sandbox')
      expect(read(new Uint8Array(await res.arrayBuffer()))).toBe('%PDF')
    }
  })

  it('hands out URLs under the API origin', async () => {
    expect(await a().getUrl('x.txt')).toMatch(/^http:\/\/localhost:5200\/api\/files\/local\/[^/]+$/)
  })

  it('uploads through a signed PUT with the signed content type, then reads it back', async () => {
    const url = await a().putUrl('up/photo.png', { contentType: 'image/png' })
    const put = await serve(url, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: text('png'),
    })
    expect(put.status).toBe(200)
    expect(read(await a().get('up/photo.png'))).toBe('png')
    const got = await serve(await a().getUrl('up/photo.png'))
    expect(got.headers.get('content-type')).toBe('image/png')
  })

  it('refuses (403) an upload without the signed content type', async () => {
    const url = await a().putUrl('up/strict.png', { contentType: 'image/png' })
    const res = await serve(url, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: text('x'),
    })
    expect(res.status).toBe(403)
    await expect(a().get('up/strict.png')).rejects.toBeInstanceOf(FileNotFoundError)
  })

  it('refuses (403) unsigned, tampered, wrong-method and expired URLs', async () => {
    await a().put('secret.txt', text('s'), 'text/plain')
    const url = await a().getUrl('secret.txt', { expiresIn: 60 })
    const [prefix, token] = [
      url.slice(0, url.lastIndexOf('/') + 1),
      url.slice(url.lastIndexOf('/') + 1),
    ]
    expect((await serve(`${prefix}nothing-signed`)).status).toBe(403)
    expect((await serve(`${prefix}${token}x`)).status).toBe(403)
    const forged = Buffer.from(
      JSON.stringify({ k: `${ORG_B}/secret.txt`, m: 'GET', e: 9_999_999_999 }),
    ).toString('base64url')
    expect((await serve(`${prefix}${forged}.${token!.split('.')[1]}`)).status).toBe(403)
    expect((await serve(url, { method: 'PUT', body: text('overwrite') })).status).toBe(403)
    expect((await serve(url)).status).toBe(200)
    clock = new Date(clock.getTime() + 61_000)
    expect((await serve(url)).status).toBe(403)
  })

  it('serves only safe types inline and everything else as a sandboxed download', async () => {
    await a().put('xss/page.html', text('<script>alert(1)</script>'), 'text/html')
    await a().put('xss/logo.svg', text('<svg onload="alert(1)"/>'), 'image/svg+xml')
    await a().put('ok/photo.png', text('png'), 'image/png')
    for (const name of ['xss/page.html', 'xss/logo.svg']) {
      const res = await serve(await a().getUrl(name))
      expect(res.headers.get('content-disposition')).toBe('attachment')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('content-security-policy')).toContain('sandbox')
    }
    const png = await serve(await a().getUrl('ok/photo.png'))
    expect(png.headers.get('content-disposition')).toBe('inline')
  })

  it('stores an upload without a signed content type as octet-stream, whatever it sends', async () => {
    const url = await a().putUrl('up/untyped')
    const put = await serve(url, {
      method: 'PUT',
      headers: { 'content-type': 'text/html' },
      body: text('<script>alert(1)</script>'),
    })
    expect(put.status).toBe(200)
    const got = await serve(await a().getUrl('up/untyped'))
    expect(got.headers.get('content-type')).toBe('application/octet-stream')
    expect(got.headers.get('content-disposition')).toBe('attachment')
  })

  it('answers 404 for a signed URL to a file that is not there', async () => {
    expect((await serve(await a().getUrl('missing.txt'))).status).toBe(404)
  })
})

describe('local storage without a signing secret', () => {
  it('refuses to presign', async () => {
    const files = localStorage(join(dir, 'unsigned')).forOrganization(ORG_A)
    await expect(files.getUrl('a.txt')).rejects.toThrow('does not presign')
    await expect(files.putUrl('a.txt')).rejects.toThrow('does not presign')
  })
})
