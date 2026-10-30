const BEARER = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i

/**
 * The token68 an `Authorization: Bearer` header carries, or null for any other header.
 * A `?access_token=` query parameter is never read.
 */
export const bearerToken = (header: string | null | undefined): string | null =>
  BEARER.exec(header ?? '')?.[1] ?? null
