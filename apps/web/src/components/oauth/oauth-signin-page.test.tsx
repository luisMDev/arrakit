import type { AuthProviders } from '@arrakit/contract'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '#/i18n'

import { type AuthApi, AuthApiContext } from '#/components/auth/auth-api'

import { OAuthSignInPage } from './oauth-signin-page'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const SIGNED =
  '?response_type=code&client_id=claude&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s&code_challenge=cc&code_challenge_method=S256&resource=http%3A%2F%2Flocalhost%3A4200%2Fapi%2Fmcp&exp=1&sig=xyz'
const RESUME =
  '/api/auth/oauth2/authorize?response_type=code&client_id=claude&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s&code_challenge=cc&code_challenge_method=S256&resource=http%3A%2F%2Flocalhost%3A4200%2Fapi%2Fmcp'

function fakeApi(providers: AuthProviders = { google: true, microsoft: true }) {
  return {
    sendMagicLink: vi.fn<AuthApi['sendMagicLink']>(async () => undefined),
    signInWith: vi.fn<AuthApi['signInWith']>(() => new Promise<void>(() => undefined)),
    providers: vi.fn<AuthApi['providers']>(async () => providers),
  }
}

function renderPage(api: AuthApi, search = SIGNED) {
  return render(
    <AuthApiContext.Provider value={api}>
      <OAuthSignInPage search={search} />
    </AuthApiContext.Provider>,
  )
}

describe('OAuthSignInPage', () => {
  it('asks to sign in to connect, with the providers the API reports', async () => {
    renderPage(fakeApi({ google: false, microsoft: true }))
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
    const api = fakeApi()
    renderPage(api)
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Work email' }),
      ' Lucia.Gomez@Cierzo.vc ',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(api.sendMagicLink).toHaveBeenCalledWith('lucia.gomez@cierzo.vc', RESUME)
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
      const api = fakeApi()
      renderPage(api)
      await userEvent.click(await screen.findByRole('button', { name: `Continue with ${name}` }))
      expect(api.signInWith).toHaveBeenCalledWith(provider, RESUME)
      await waitFor(() => {
        for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
      })
    },
  )

  it('explains a provider refusal and resumes without via or error', async () => {
    const api = fakeApi()
    renderPage(api, `${SIGNED}&via=microsoft&error=email_not_verified`)
    expect(screen.getByRole('alert')).toHaveTextContent('Microsoft')
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    expect(api.signInWith).toHaveBeenCalledWith('google', RESUME)
  })

  it('explains a used or expired link above the options', async () => {
    renderPage(fakeApi(), `${SIGNED}&error=INVALID_TOKEN`)
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeVisible()
  })

  it('says the link is incomplete without a client, and offers nothing', async () => {
    const api = fakeApi()
    renderPage(api, '?state=s&sig=x')
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link is incomplete.' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Start again from the app you were connecting Arrakit to.'),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(api.providers).not.toHaveBeenCalled()
  })

  it('keeps prompt values other than login', async () => {
    const api = fakeApi()
    renderPage(api, `${SIGNED}&prompt=login%20consent`)
    await userEvent.type(screen.getByRole('textbox', { name: 'Work email' }), 'ana@acme.com')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(api.sendMagicLink).toHaveBeenCalledWith('ana@acme.com', `${RESUME}&prompt=consent`)
  })
})
