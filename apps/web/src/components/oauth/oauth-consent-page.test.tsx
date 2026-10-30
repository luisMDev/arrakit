import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '#/i18n'

import { type OAuthApi, OAuthApiContext } from './oauth-api'
import { OAuthConsentPage } from './oauth-consent-page'

const QUERY = 'response_type=code&client_id=claude-id&state=s%2Fx&exp=1&sig=abc'

function fakeApi(organization: { name: string } | null = { name: 'Ardent Ventures' }) {
  return {
    publicClient: vi.fn<OAuthApi['publicClient']>(async () => ({ name: 'Claude' })),
    currentOrganization: vi.fn<OAuthApi['currentOrganization']>(async () => organization),
    consent: vi.fn<OAuthApi['consent']>(() => new Promise<void>(() => undefined)),
  }
}

function renderPage(api: OAuthApi, search = `?${QUERY}`) {
  return render(
    <OAuthApiContext.Provider value={api}>
      <OAuthConsentPage search={search} />
    </OAuthApiContext.Provider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('OAuthConsentPage', () => {
  it('loads the client and the organization, then asks with Allow and Deny only', async () => {
    const api = fakeApi()
    renderPage(api)
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Connect Claude' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Claude will act as you in Ardent Ventures.')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Allow', 'Deny'])
    expect(api.publicClient).toHaveBeenCalledWith('claude-id')
  })

  it('sends the same query, exactly as received, for Allow and for Deny', async () => {
    const api = fakeApi()
    api.consent.mockRejectedValueOnce(new Error('first fails'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderPage(api)

    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't finish connecting. Try again.",
    )
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }))

    expect(api.consent.mock.calls).toEqual([
      [true, QUERY],
      [false, QUERY],
    ])
  })

  it('disables both buttons while an answer is pending', async () => {
    const api = fakeApi()
    renderPage(api)
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(api.consent).toHaveBeenCalledTimes(1)
  })

  it('retries after a failure: a second click records a second consent', async () => {
    const api = fakeApi()
    api.consent.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(undefined)
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderPage(api)

    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(report).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(api.consent).toHaveBeenCalledTimes(2)
  })

  it('offers only a way back, which denies, to a person in no organization', async () => {
    const api = fakeApi(null)
    renderPage(api)
    expect(
      await screen.findByRole('heading', { level: 1, name: "You're not in an organization yet." }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Claude acts within an organization. Join yours, or set one up, then connect again.',
      ),
    ).toBeInTheDocument()
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Back to Claude'])
    await userEvent.click(buttons[0]!)
    expect(api.consent).toHaveBeenCalledWith(false, QUERY)
  })

  it('says the request is unavailable when loading fails, and reports it', async () => {
    const api = fakeApi()
    api.publicClient.mockRejectedValueOnce(new Error('404'))
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderPage(api)
    expect(
      await screen.findByRole('heading', { level: 1, name: "Couldn't open this request." }),
    ).toBeInTheDocument()
    expect(report).toHaveBeenCalled()
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it.each([
    ['without a signature', '?client_id=claude-id&state=s'],
    ['without a client', '?state=s&sig=abc'],
  ])('says the link is incomplete %s, and calls nothing', async (_label, search) => {
    const api = fakeApi()
    renderPage(api, search)
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link is incomplete.' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Start again from the app you were connecting Arrakit to.'),
    ).toBeInTheDocument()
    expect(api.publicClient).not.toHaveBeenCalled()
    expect(api.currentOrganization).not.toHaveBeenCalled()
    expect(screen.queryAllByRole('button')).toEqual([])
  })
})

describe('createHttpOAuthApi', () => {
  it('names the client and sends the window to the consent answer', async () => {
    const { createHttpOAuthApi } = await import('./oauth-api')
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ client_id: 'id-1' }))
      .mockResolvedValueOnce(Response.json({ url: 'https://claude.ai/cb?code=1' }))
    const redirect = vi.fn()
    const api = createHttpOAuthApi({ redirect })

    expect(await api.publicClient('id-1')).toEqual({ name: 'id-1' })
    await api.consent(true, QUERY)

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/auth/oauth2/public-client?client_id=id-1')
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({
      accept: true,
      oauth_query: QUERY,
    })
    expect(redirect).toHaveBeenCalledWith('https://claude.ai/cb?code=1')
  })

  it('treats a consent answer without a url as a failure', async () => {
    const { createHttpOAuthApi } = await import('./oauth-api')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ error: 'access_denied' }))
    const redirect = vi.fn()
    await expect(createHttpOAuthApi({ redirect }).consent(true, QUERY)).rejects.toThrow()
    expect(redirect).not.toHaveBeenCalled()
  })
})
