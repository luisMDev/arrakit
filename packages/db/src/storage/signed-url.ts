import { createHmac, timingSafeEqual } from 'node:crypto'

/** Where the API serves the fallback storages' presigned URLs. */
export const SIGNED_FILES_PATH = '/api/files/local/'

export const DEFAULT_URL_EXPIRES_IN = 900

export interface UrlSigning {
  /** HMAC key, e.g. derived from BETTER_AUTH_SECRET. */
  secret: string
  /** Origin the browser reaches the API at (the web origin, through the proxy). */
  baseUrl: string
  now?: () => Date
}

interface Grant {
  /** Full storage key. */
  k: string
  m: 'GET' | 'PUT'
  /** Expiry, epoch seconds. */
  e: number
  /** Content type the upload must be sent with. */
  t?: string
}

/** A blob store addressed by full key, which the signed URLs read and write. */
export interface SignedStore {
  read(key: string): Promise<{ bytes: Uint8Array; contentType: string } | undefined>
  write(key: string, bytes: Uint8Array, contentType: string): Promise<void>
}

/** Types a browser may render inline from the app's origin; anything else is served as a download. */
const INLINE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
  'text/plain',
])

const isInline = (contentType: string) =>
  INLINE_TYPES.has(contentType.split(';')[0]!.trim().toLowerCase())

const sign = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(`storage-url\n${payload}`).digest('base64url')

const forbidden = (message: string) =>
  new Response(JSON.stringify({ message }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  })

/**
 * Presigned URLs for the local and in-memory storages, with S3's semantics: a URL works only for
 * its method and key, until it expires, and a PUT signed with a content type must send it.
 */
export function urlSigner(signing: UrlSigning) {
  const now = () => (signing.now ?? (() => new Date()))().getTime()
  const base = signing.baseUrl.replace(/\/$/, '')

  const url = (key: string, method: Grant['m'], expiresIn: number, contentType?: string) => {
    const grant: Grant = {
      k: key,
      m: method,
      e: Math.floor(now() / 1000) + expiresIn,
      ...(contentType ? { t: contentType } : {}),
    }
    const payload = Buffer.from(JSON.stringify(grant)).toString('base64url')
    return `${base}${SIGNED_FILES_PATH}${payload}.${sign(signing.secret, payload)}`
  }

  const verify = (token: string): Grant | undefined => {
    const [payload, signature, extra] = token.split('.')
    if (!payload || !signature || extra !== undefined) return undefined
    const expected = Buffer.from(sign(signing.secret, payload))
    const given = Buffer.from(signature)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined
    try {
      return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Grant
    } catch {
      return undefined
    }
  }

  /** Answers a request to SIGNED_FILES_PATH: 403 unless signed for it and unexpired; 404 when missing. */
  const serve = async (request: Request, store: SignedStore): Promise<Response> => {
    const path = new URL(request.url).pathname
    if (!path.startsWith(SIGNED_FILES_PATH)) return forbidden('Not a signed file URL.')
    const grant = verify(path.slice(SIGNED_FILES_PATH.length))
    if (!grant || grant.m !== request.method) return forbidden('The URL is not signed for this.')
    if (grant.e * 1000 <= now()) return forbidden('The URL has expired.')
    if (grant.m === 'GET') {
      const found = await store.read(grant.k)
      if (!found)
        return new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      // S3 serves files from the bucket's own origin; these come from the web origin (through the
      // /api proxy), so an uploaded HTML or SVG file must not run script with the app's cookies.
      return new Response(found.bytes, {
        headers: {
          'content-type': found.contentType,
          'content-disposition': isInline(found.contentType) ? 'inline' : 'attachment',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "sandbox; default-src 'none'",
        },
      })
    }
    const sent = request.headers.get('content-type') ?? undefined
    if (grant.t && sent !== grant.t)
      return forbidden('The upload must send the signed content type.')
    const bytes = new Uint8Array(await request.arrayBuffer())
    // Without a signed type the uploader does not get to choose how the file is served.
    await store.write(grant.k, bytes, grant.t ?? 'application/octet-stream')
    return new Response(null, { status: 200 })
  }

  return { url, serve }
}
