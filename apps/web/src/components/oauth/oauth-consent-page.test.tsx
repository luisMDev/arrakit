import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '#/i18n'
import { renderAt, setupAuthTestApi } from '#/test/rpc'
import { answer, answerAuth, meAs } from '#/test/rpc'

import { OAuthConsentPage } from './oauth-consent-page'

const QUERY = 'response_type=code&client_id=claude-id&state=s%2Fx&exp=1&sig=abc'

const ARDENT = { ...meAs().organization!, name: 'Ardent Ventures' }
const BIRCH = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Birch',
  slug: 'birch',
  plan: 'free',
}

setupAuthTestApi()

const pending = () => new Promise(() => undefined)
const asked = (accept: boolean) => ({ input: { accept, oauth_query: QUERY } })

let meCalls: ReturnType<typeof answer>
let clients: ReturnType<typeof answerAuth>
let consents: ReturnType<typeof answerAuth>

beforeEach(() => {
  clients = answerAuth('oauth2/public-client', { client_id: 'claude-id', client_name: 'Claude' })
  consents = answerAuth('oauth2/consent', pending)
  meCalls = answer(
    'me/get',
    meAs({ organization: { ...meAs().organization!, name: 'Ardent Ventures' } }),
  )
  answerAuth('organization/list', [ARDENT])
})

async function renderPage(search = `?${QUERY}`) {
  const view = renderAt(<OAuthConsentPage search={search} />, { me: null, url: '/oauth/consent' })
  await act(() => view.router.load())
  return view
}

const FAILED = "Couldn't finish connecting. Try again."

describe('OAuthConsentPage', () => {
  it('lets a person in several organizations pick the one to connect', async () => {
    const lists = answerAuth('organization/list', [ARDENT, BIRCH])
    const chosen = answerAuth('organization/set-active', BIRCH)
    await renderPage()
    const picker = await screen.findByRole('combobox', { name: 'Organization' })
    expect(picker).toHaveTextContent('Ardent Ventures')
    answer('me/get', meAs({ organization: BIRCH as never }))
    await userEvent.click(picker)
    await userEvent.click(await screen.findByRole('option', { name: 'Birch' }))
    expect(await screen.findByText('Claude will act as you in Birch.')).toBeInTheDocument()
    expect(chosen).toEqual([{ input: { organizationId: BIRCH.id } }])
    expect(chosen[0]!.input).not.toHaveProperty('oauth_query')
    expect(lists).toHaveLength(1)
    expect(clients).toHaveLength(1)
  })

  it('shows no picker to a person in one organization', async () => {
    const lists = answerAuth('organization/list', [ARDENT])
    await renderPage()
    expect(
      await screen.findByText('Claude will act as you in Ardent Ventures.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(lists).toHaveLength(1))
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('loads the client and the organization, then asks with Allow and Deny only', async () => {
    await renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Connect Claude' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Claude will act as you in Ardent Ventures.')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Allow', 'Deny'])
    expect(clients).toEqual([{ input: { client_id: 'claude-id' } }])
  })

  it('names the client by its id when it gave no name', async () => {
    answerAuth('oauth2/public-client', { client_id: 'claude-id' })
    await renderPage()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Connect claude-id' }),
    ).toBeInTheDocument()
  })

  it('sends the same query, exactly as received, for Allow and for Deny', async () => {
    consents = answerAuth('oauth2/consent', 500, pending)
    await renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(await screen.findByText(FAILED)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => expect(consents).toEqual([asked(true), asked(false)]))
  })

  it('disables both buttons while an answer is pending', async () => {
    await renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(consents).toHaveLength(1)
  })

  it('treats a consent answer without a url as a failure', async () => {
    answerAuth('oauth2/consent', { error: 'access_denied' })
    await renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(await screen.findByText(FAILED)).toBeInTheDocument()
  })

  it('retries after a failure: a second click records a second consent', async () => {
    consents = answerAuth('oauth2/consent', 500, { url: '#connected' })
    await renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(await screen.findByText(FAILED)).toBeVisible()
    expect(console.error).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(consents).toHaveLength(2))
    await vi.waitFor(() => expect(window.location.hash).toBe('#connected'))
  })

  it('offers only a way back, which denies, to a person in no organization', async () => {
    answer('me/get', meAs({ organization: null, role: null, plan: null }))
    await renderPage()
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
    await waitFor(() => expect(consents).toEqual([asked(false)]))
  })

  it('says the request is unavailable when loading fails, and reports it', async () => {
    answerAuth('oauth2/public-client', 404)
    await renderPage()
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
    await renderPage(search)
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link is incomplete.' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Start again from the app you were connecting Arrakit to.'),
    ).toBeInTheDocument()
    expect(clients).toEqual([])
    expect(meCalls).toEqual([])
    expect(screen.queryAllByRole('button')).toEqual([])
  })
})
