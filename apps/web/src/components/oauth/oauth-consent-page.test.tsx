import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '#/i18n'
import { renderWithQueries, setupAuthTestApi } from '#/components/auth/testing'
import { answer, meAs } from '#/test/rpc'

import { consent, publicClientName } from './oauth-api'
import { OAuthConsentPage } from './oauth-consent-page'

vi.mock('./oauth-api', async (original) => ({
  ...(await original<typeof import('./oauth-api')>()),
  publicClientName: vi.fn(),
  consent: vi.fn(),
}))

const QUERY = 'response_type=code&client_id=claude-id&state=s%2Fx&exp=1&sig=abc'

const clientName = vi.mocked(publicClientName)
const answerConsent = vi.mocked(consent)

setupAuthTestApi()

let meCalls: ReturnType<typeof answer>

beforeEach(() => {
  clientName.mockReset().mockResolvedValue('Claude')
  answerConsent.mockReset().mockReturnValue(new Promise(() => undefined))
  meCalls = answer(
    'me/get',
    meAs({ organization: { ...meAs().organization!, name: 'Ardent Ventures' } }),
  )
})

const renderPage = (search = `?${QUERY}`) => renderWithQueries(<OAuthConsentPage search={search} />)

const FAILED = "Couldn't finish connecting. Try again."

describe('OAuthConsentPage', () => {
  it('loads the client and the organization, then asks with Allow and Deny only', async () => {
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Connect Claude' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Claude will act as you in Ardent Ventures.')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Allow', 'Deny'])
    expect(clientName).toHaveBeenCalledWith('claude-id')
  })

  it('sends the same query, exactly as received, for Allow and for Deny', async () => {
    answerConsent.mockRejectedValueOnce(new Error('first fails'))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(await screen.findByText(FAILED)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }))

    expect(answerConsent.mock.calls).toEqual([
      [true, QUERY],
      [false, QUERY],
    ])
  })

  it('disables both buttons while an answer is pending', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(answerConsent).toHaveBeenCalledTimes(1)
  })

  it('retries after a failure: a second click records a second consent', async () => {
    answerConsent.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce('#connected')
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(await screen.findByText(FAILED)).toBeVisible()
    expect(console.error).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(answerConsent).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(window.location.hash).toBe('#connected'))
  })

  it('offers only a way back, which denies, to a person in no organization', async () => {
    answer('me/get', meAs({ organization: null, role: null, plan: null }))
    renderPage()
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
    expect(answerConsent).toHaveBeenCalledWith(false, QUERY)
  })

  it('says the request is unavailable when loading fails, and reports it', async () => {
    clientName.mockRejectedValueOnce(new Error('404'))
    renderPage()
    expect(
      await screen.findByRole('heading', { level: 1, name: "Couldn't open this request." }),
    ).toBeInTheDocument()
    expect(console.error).toHaveBeenCalled()
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it.each([
    ['without a signature', '?client_id=claude-id&state=s'],
    ['without a client', '?state=s&sig=abc'],
  ])('says the link is incomplete %s, and calls nothing', async (_label, search) => {
    renderPage(search)
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link is incomplete.' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Start again from the app you were connecting Arrakit to.'),
    ).toBeInTheDocument()
    expect(clientName).not.toHaveBeenCalled()
    expect(meCalls).toEqual([])
    expect(screen.queryAllByRole('button')).toEqual([])
  })
})
