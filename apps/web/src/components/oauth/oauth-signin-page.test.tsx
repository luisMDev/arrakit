import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '#/i18n'
import { sendMagicLink, socialSignInUrl } from '#/components/auth/auth-api'
import { renderWithQueries, setupAuthTestApi } from '#/test/rpc'
import { answer } from '#/test/rpc'

import { OAuthSignInPage } from './oauth-signin-page'

vi.mock('#/components/auth/auth-api', async (original) => ({
  ...(await original<typeof import('#/components/auth/auth-api')>()),
  sendMagicLink: vi.fn(),
  socialSignInUrl: vi.fn(),
}))

const sendLink = vi.mocked(sendMagicLink)
const startSocial = vi.mocked(socialSignInUrl)

setupAuthTestApi({ google: true, microsoft: true })

beforeEach(() => {
  sendLink.mockReset().mockResolvedValue(true)
  startSocial.mockReset().mockReturnValue(new Promise(() => undefined))
})

const SIGNED =
  '?response_type=code&client_id=claude&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s&code_challenge=cc&code_challenge_method=S256&resource=http%3A%2F%2Flocalhost%3A5200%2Fapi%2Fmcp&exp=1&sig=xyz'
const RESUME =
  '/api/auth/oauth2/authorize?response_type=code&client_id=claude&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s&code_challenge=cc&code_challenge_method=S256&resource=http%3A%2F%2Flocalhost%3A5200%2Fapi%2Fmcp'

const renderPage = (search = SIGNED) => renderWithQueries(<OAuthSignInPage search={search} />)

describe('OAuthSignInPage', () => {
  it('asks to sign in to connect, with the providers the API reports', async () => {
    answer('authProviders/get', { google: false, microsoft: true })
    renderPage()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sign in to connect Arrakit' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Use your organization's account. You'll see what is shared before anything is.",
      ),
    ).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Continue with Microsoft' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull()
  })

  it('sends a magic link that lands on authorize without the signature, email lowercased', async () => {
    renderPage()
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Work email' }),
      ' Lucia.Gomez@Cierzo.vc ',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(sendLink).toHaveBeenCalledWith('lucia.gomez@cierzo.vc', RESUME)
    expect(await screen.findByRole('heading', { level: 1, name: /Check your/ })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Use a different email' }))
    expect(screen.getByRole('textbox', { name: 'Work email' })).toHaveValue('lucia.gomez@cierzo.vc')
  })

  it.each([
    ['Google', 'google'],
    ['Microsoft', 'microsoft'],
  ] as const)(
    'lands %s on authorize and disables every button after one click',
    async (name, provider) => {
      renderPage()
      await userEvent.click(await screen.findByRole('button', { name: `Continue with ${name}` }))
      expect(startSocial).toHaveBeenCalledWith(provider, RESUME)
      await waitFor(() => {
        for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
      })
    },
  )

  it('explains a provider refusal and resumes without via or error', async () => {
    renderPage(`${SIGNED}&via=microsoft&error=email_not_verified`)
    expect(screen.getByRole('alert')).toHaveTextContent('Microsoft')
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    expect(startSocial).toHaveBeenCalledWith('google', RESUME)
  })

  it('explains a used or expired link above the options', async () => {
    renderPage(`${SIGNED}&error=INVALID_TOKEN`)
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeVisible()
  })

  it('says the link is incomplete without a client, and offers nothing', async () => {
    const calls = answer('authProviders/get', { google: true, microsoft: true })
    renderPage('?state=s&sig=x')
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link is incomplete.' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Start again from the app you were connecting Arrakit to.'),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(calls).toEqual([])
  })

  it('keeps prompt values other than login', async () => {
    renderPage(`${SIGNED}&prompt=login%20consent`)
    await userEvent.type(screen.getByRole('textbox', { name: 'Work email' }), 'ana@acme.com')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(sendLink).toHaveBeenCalledWith('ana@acme.com', `${RESUME}&prompt=consent`)
  })
})
