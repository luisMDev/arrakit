import { describe, expect, it } from 'vitest'

import { UPLOAD_URL_SECONDS } from './folder'
import { supabaseStorage } from './supabase'

const ORG = '0193b2a4-5c6d-7e8f-9a0b-1c2d3e4f5a6b'
const OTHER = '0193b2a4-5c6d-7e8f-9a0b-1c2d3e4f5a6c'
const config = { url: 'https://project.supabase.co/', secretKey: 'sb_secret_test' }

interface Sent {
  method: string
  path: string
  headers: Headers
  body: unknown
}

type Answer = { status?: number; body: unknown }

const notFound = (code: string): Answer => ({
  status: 400,
  body: { statusCode: '404', error: 'not_found', message: 'Object not found', code },
})

function fakeStorage(answer: (request: Sent) => Answer, options: { listPageSize?: number } = {}) {
  const sent: Sent[] = []
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    const raw = init.body
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw
    const request = {
      method: init.method ?? 'GET',
      path: url.pathname + url.search,
      headers: new Headers(init.headers),
      body,
    }
    sent.push(request)
    const { status = 200, body: payload } = answer(request)
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  const storage = supabaseStorage(config, { fetch, ...options })
  return { sent, files: storage.forOrganization(ORG), storage }
}

const listPage = (keys: string[], nextCursor?: string): Answer => ({
  body: {
    folders: [],
    objects: keys.map((name) => ({ name })),
    hasNext: nextCursor !== undefined,
    nextCursor,
  },
})

describe('supabaseStorage', () => {
  it('validates the folder before any request', async () => {
    const { sent, files } = fakeStorage(() => ({ body: {} }))
    await expect(files.list('../escape/')).rejects.toThrow('not a usable folder')
    await expect(files.removePrefix('../escape/')).rejects.toThrow('not a usable folder')
    expect(sent).toEqual([])
  })

  it('lists page by page, relative to the organization', async () => {
    const { sent, files } = fakeStorage(
      ({ body }) =>
        (body as { cursor?: string }).cursor === 'next'
          ? listPage([`${ORG}/c1/sub/b.pdf`])
          : listPage([`${ORG}/c1/a.pdf`], 'next'),
      { listPageSize: 1 },
    )

    expect(await files.list('c1/')).toEqual([{ path: 'c1/a.pdf' }, { path: 'c1/sub/b.pdf' }])
    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /storage/v1/object/list-v2/files',
      'POST /storage/v1/object/list-v2/files',
    ])
    expect(sent[0]?.body).toEqual({ prefix: `${ORG}/c1/`, limit: 1, with_delimiter: false })
    expect(sent[1]?.body).toEqual({
      prefix: `${ORG}/c1/`,
      limit: 1,
      with_delimiter: false,
      cursor: 'next',
    })
  })

  it('removes a folder with the keys it listed, in batches of 100', async () => {
    const keys = Array.from({ length: 250 }, (_, i) => `${ORG}/workspaces/w1/${i}.pdf`)
    const { sent, files } = fakeStorage(({ method }) =>
      method === 'DELETE' ? { body: [] } : listPage(keys),
    )

    await files.removePrefix('workspaces/w1/')
    const deletes = sent.filter(({ method }) => method === 'DELETE')
    expect(deletes.map(({ path }) => path)).toEqual(Array(3).fill('/storage/v1/object/files'))
    expect(deletes.map(({ body }) => (body as { prefixes: string[] }).prefixes.length)).toEqual([
      100, 100, 50,
    ])
    expect(deletes.flatMap(({ body }) => (body as { prefixes: string[] }).prefixes)).toEqual(keys)
  })

  it('sends only the listing for an empty folder', async () => {
    const { sent, files } = fakeStorage(() => listPage([]))
    await files.removePrefix('')
    expect(sent.map(({ method }) => method)).toEqual(['POST'])
    expect(sent[0]?.body).toMatchObject({ prefix: `${ORG}/` })
  })

  it('refuses to remove anything when the listing answers a key outside the prefix', async () => {
    const { sent, files } = fakeStorage(() => listPage([`${ORG}/a.pdf`, `${OTHER}/b.pdf`]))
    await expect(files.removePrefix('')).rejects.toThrow('outside')
    expect(sent.filter(({ method }) => method === 'DELETE')).toEqual([])
  })

  it('signs an upload that lasts as long as Storage keeps it', async () => {
    const key = `${ORG}/files/1`
    const { sent, files } = fakeStorage(() => ({
      body: { url: `/object/upload/sign/files/${key}?token=tok` },
    }))

    const before = Date.now()
    const ticket = await files.presignPut('files/1', {
      contentType: 'application/pdf',
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.method).toBe('POST')
    expect(sent[0]?.path).toBe(`/storage/v1/object/upload/sign/files/${key}`)
    expect(sent[0]?.headers.get('apikey')).toBe('sb_secret_test')
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer sb_secret_test')
    expect(sent[0]?.headers.has('x-upsert')).toBe(false)
    expect(ticket.url).toBe(
      `https://project.supabase.co/storage/v1/object/upload/sign/files/${key}?token=tok`,
    )
    expect(ticket.url).not.toContain('sb_secret_test')
    expect(ticket.headers).toEqual({ 'content-type': 'application/pdf' })
    const lifetime = ticket.expiresAt.getTime() - before
    expect(lifetime).toBeGreaterThanOrEqual(UPLOAD_URL_SECONDS * 1000)
    expect(lifetime).toBeLessThan(UPLOAD_URL_SECONDS * 1000 + 5000)
  })

  it.each(['Q3 report.pdf', 'Año "final".md'])(
    'signs a download saved as %s',
    async (downloadName) => {
      const key = `${ORG}/files/1`
      const { sent, files } = fakeStorage(() => ({
        body: { signedURL: `/object/sign/files/${key}?token=tok` },
      }))

      const { url } = await files.presignGet('files/1', { downloadName, expiresInSeconds: 300 })

      expect(sent[0]?.method).toBe('POST')
      expect(sent[0]?.path).toBe(`/storage/v1/object/sign/files/${key}`)
      expect(sent[0]?.body).toEqual({ expiresIn: 300 })
      const signed = new URL(url)
      expect(signed.pathname).toBe(`/storage/v1/object/sign/files/${key}`)
      expect(signed.searchParams.get('token')).toBe('tok')
      expect(signed.searchParams.get('download')).toBe(downloadName)
    },
  )

  it('reads the size and type of an object', async () => {
    const { sent, files } = fakeStorage(() => ({ body: { size: 7, content_type: 'text/plain' } }))
    expect(await files.head('files/1')).toEqual({ size: 7, contentType: 'text/plain' })
    expect(sent[0]?.path).toBe(`/storage/v1/object/info/files/${ORG}/files/1`)
  })

  it('answers undefined only for a missing object', async () => {
    expect(await fakeStorage(() => notFound('NoSuchKey')).files.head('files/1')).toBeUndefined()
    await expect(
      fakeStorage(() => notFound('NoSuchBucket')).files.head('files/1'),
    ).rejects.toMatchObject({ code: 'NoSuchBucket' })
    await expect(
      fakeStorage(() => ({
        status: 500,
        body: { statusCode: '500', error: 'internal', message: 'boom' },
      })).files.head('files/1'),
    ).rejects.toMatchObject({ status: 500 })
  })

  it('uploads from the server without replacing an object', async () => {
    const key = `${ORG}/files/1`
    const { sent, files } = fakeStorage(() => ({ body: { Id: 'id', Key: `files/${key}` } }))
    const bytes = new TextEncoder().encode('# notes')

    await files.put('files/1', bytes, 'text/plain')

    expect(sent[0]?.method).toBe('POST')
    expect(sent[0]?.path).toBe(`/storage/v1/object/files/${key}`)
    expect(sent[0]?.headers.get('content-type')).toBe('text/plain')
    expect(sent[0]?.headers.get('x-upsert')).toBe('false')
    expect(sent[0]?.body).toBe(bytes)
  })

  it('removes one object', async () => {
    const { sent, files } = fakeStorage(() => ({ body: [] }))
    await files.remove('files/1')
    expect(sent[0]?.method).toBe('DELETE')
    expect(sent[0]?.path).toBe('/storage/v1/object/files')
    expect(sent[0]?.body).toEqual({ prefixes: [`${ORG}/files/1`] })
  })

  it('probes by reading the bucket', async () => {
    const ok = fakeStorage(() => ({ body: { id: 'files', public: false } }))
    await ok.storage.probe()
    expect(ok.sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /storage/v1/bucket/files',
    ])

    const missing = fakeStorage(() => notFound('NoSuchBucket'))
    await expect(missing.storage.probe()).rejects.toMatchObject({ code: 'NoSuchBucket' })
  })
})
