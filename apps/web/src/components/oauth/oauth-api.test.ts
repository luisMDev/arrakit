import { afterEach, describe, expect, it, vi } from 'vitest'

import { consent, publicClientName } from './oauth-api'

const QUERY = 'response_type=code&client_id=claude-id&state=s%2Fx&exp=1&sig=abc'

afterEach(() => vi.restoreAllMocks())

describe('oauth calls', () => {
  it('names the client by its id when it gave no name, and answers where consent leads', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ client_id: 'id-1' }))
      .mockResolvedValueOnce(Response.json({ url: 'https://claude.ai/cb?code=1' }))

    expect(await publicClientName('id-1')).toBe('id-1')
    expect(await consent(true, QUERY)).toBe('https://claude.ai/cb?code=1')

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/auth/oauth2/public-client?client_id=id-1')
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({
      accept: true,
      oauth_query: QUERY,
    })
  })

  it('treats a consent answer without a url as a failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ error: 'access_denied' }))
    await expect(consent(true, QUERY)).rejects.toThrow()
  })
})
