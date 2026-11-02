import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '#/i18n'
import { answer } from '#/test/rpc'

import { sendMagicLink, socialSignInUrl } from './auth-api'
import { refusalSearch } from './sign-in-options'
import { SignupPage, type SignupSearch } from './signup-page'
import { renderAt, setupAuthTestApi } from '#/test/rpc'

vi.mock('./auth-api', async (original) => ({
  ...(await original<typeof import('./auth-api')>()),
  sendMagicLink: vi.fn(),
  socialSignInUrl: vi.fn(),
}))

const sendLink = vi.mocked(sendMagicLink)
const startSocial = vi.mocked(socialSignInUrl)

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

setupAuthTestApi()

beforeEach(() => {
  sendLink.mockReset().mockResolvedValue(true)
  startSocial.mockReset().mockReturnValue(new Promise(() => undefined))
})

async function renderPage({
  mode = 'new',
  search = {},
}: { mode?: 'new' | 'returning'; search?: SignupSearch } = {}) {
  const view = renderAt(<SignupPage mode={mode} search={search} />, { me: null, url: '/signup' })
  await act(() => view.router.load())
  return view
}

const emailInput = () => screen.getByRole('textbox', { name: 'Work email' })
const continueButton = () => screen.getByRole('button', { name: 'Continue' })
const googleButton = () => screen.getByRole('button', { name: 'Continue with Google' })
const googleShown = () => screen.findByRole('button', { name: 'Continue with Google' })

async function typeAndContinue(email: string) {
  await userEvent.type(emailInput(), email)
  await userEvent.click(continueButton())
}

describe('SignupPage', () => {
  it('shows the copy and the form', async () => {
    await renderPage()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Where should we write to you?' }),
    ).toBeInTheDocument()
    expect(emailInput()).toHaveAttribute('type', 'email')
    expect(emailInput()).toHaveAttribute('autocomplete', 'email')
    expect(emailInput()).toHaveAttribute('placeholder', 'Your work email')
    expect(screen.getByText("No password. We'll email you a link to sign in.")).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await googleShown()
  })

  it.each([
    [{ google: true, microsoft: true }, ['Google', 'Microsoft'], true],
    [{ google: true, microsoft: false }, ['Google'], true],
    [{ google: false, microsoft: true }, ['Microsoft'], true],
    [{ google: false, microsoft: false }, [], false],
  ])('shows the providers %j', async (providers, shown, divider) => {
    const calls = answer('authProviders/get', providers)
    await renderPage()
    await waitFor(() => expect(calls).toHaveLength(1))
    await waitFor(() => {
      for (const name of ['Google', 'Microsoft']) {
        const button = screen.queryByRole('button', { name: `Continue with ${name}` })
        if (shown.includes(name)) expect(button).toBeInTheDocument()
        else expect(button).not.toBeInTheDocument()
      }
    })
    if (divider) expect(screen.getByText('OR')).toBeInTheDocument()
    else expect(screen.queryByText('OR')).not.toBeInTheDocument()
  })

  it('shows no provider until the providers answer', async () => {
    answer('authProviders/get', () => new Promise(() => undefined))
    await renderPage()
    expect(continueButton()).toBeInTheDocument()
    for (const name of ['Google', 'Microsoft'])
      expect(screen.queryByRole('button', { name: `Continue with ${name}` })).toBeNull()
  })

  it.each([
    ['google', 'google', 'Google'],
    ['microsoft', 'microsoft', 'Microsoft'],
  ] as const)('starts %s with landing /profile and disables every button', async (via, _, name) => {
    answer('authProviders/get', { google: true, microsoft: true })
    await renderPage()
    const button = await screen.findByRole('button', { name: `Continue with ${name}` })
    await userEvent.click(button)
    expect(startSocial).toHaveBeenCalledWith(via, '/profile')
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled()
  })

  it.each([
    [
      { error: 'access_denied', via: 'google' },
      "Couldn't sign you in with Google. Try again, or use your email.",
    ],
    [
      { error: 'email_not_verified', via: 'microsoft' },
      "Couldn't sign you in with Microsoft. Try again, or use your email.",
    ],
    [
      { error: 'INVALID_TOKEN' },
      'That link was already used or has expired. Enter your email for a new one.',
    ],
  ])('shows the refusal for %j', async (search, message) => {
    await renderPage({ search })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent(message)
  })

  it('refuses an unwritable email on the client and sends nothing', async () => {
    await renderPage()
    await typeAndContinue('ana@acme')
    expect(emailInput()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter your work email, like name@company.com.')).toBeInTheDocument()
    expect(sendLink).not.toHaveBeenCalled()
  })

  it('sends the normalized email and says check your email, without the input', async () => {
    await renderPage()
    await typeAndContinue('  Ana@Acme.COM ')
    expect(sendLink).toHaveBeenCalledWith('ana@acme.com', '/profile')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Check your email.' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'We sent a sign-in link to ana@acme.com. Open it in this browser to carry on.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The link works once. Nothing there? Look in spam.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('carries a paid plan to the landing and drops an invalid one', async () => {
    const { unmount } = await renderPage({ search: { plan: 'team', cycle: 'monthly' } })
    await typeAndContinue('ana@acme.com')
    expect(sendLink).toHaveBeenLastCalledWith('ana@acme.com', '/profile?plan=team&cycle=monthly')
    unmount()
    await renderPage({ search: { plan: 'enterprise', cycle: 'monthly' } })
    await typeAndContinue('ana@acme.com')
    expect(sendLink).toHaveBeenLastCalledWith('ana@acme.com', '/profile')
  })

  it('goes back with the last email on Use a different email', async () => {
    await renderPage()
    await typeAndContinue('ana@acme.com')
    await userEvent.click(await screen.findByRole('button', { name: 'Use a different email' }))
    expect(emailInput()).toHaveValue('ana@acme.com')
    expect(continueButton()).toBeEnabled()
  })

  it('shows the field error on an API 400 and re-enables the button', async () => {
    sendLink.mockResolvedValueOnce(false)
    await renderPage()
    await typeAndContinue('iñigo@mesalia.es')
    expect(await screen.findByText('Enter your work email, like name@company.com.')).toBeVisible()
    expect(emailInput()).toHaveAttribute('aria-invalid', 'true')
    expect(continueButton()).toBeEnabled()
  })

  it('hides the API refusal while the email is edited', async () => {
    sendLink.mockResolvedValueOnce(false)
    await renderPage()
    await typeAndContinue('iñigo@mesalia.es')
    const error = 'Enter your work email, like name@company.com.'
    expect(await screen.findByText(error)).toBeVisible()
    await userEvent.type(emailInput(), '{Backspace}s')
    expect(screen.queryByText(error)).not.toBeInTheDocument()
    expect(emailInput()).not.toHaveAttribute('aria-invalid')
  })

  it('toasts another failure and lets the person retry', async () => {
    sendLink.mockRejectedValueOnce(new Error('500'))
    await renderPage()
    await typeAndContinue('ana@acme.com')
    expect(await screen.findByText("Couldn't send your link. Try again.")).toBeInTheDocument()
    expect(continueButton()).toBeEnabled()
    await userEvent.click(continueButton())
    expect(sendLink).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('heading', { name: 'Check your email.' })).toBeInTheDocument()
  })

  it('sends one link while one is pending', async () => {
    const pending = deferred<boolean>()
    sendLink.mockReturnValue(pending.promise)
    await renderPage()
    await googleShown()
    await userEvent.type(emailInput(), 'ana@acme.com')
    await userEvent.click(continueButton())
    expect(continueButton()).toBeDisabled()
    expect(googleButton()).toBeDisabled()
    await userEvent.type(emailInput(), '{enter}')
    expect(sendLink).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(true))
  })

  it('starts Google once while pending and retries after a failure', async () => {
    const start = deferred<string>()
    startSocial.mockReturnValueOnce(start.promise)
    await renderPage()
    await googleShown()
    await userEvent.click(googleButton())
    await userEvent.click(googleButton())
    expect(startSocial).toHaveBeenCalledTimes(1)
    await act(async () => start.reject(new Error('404')))
    expect(await screen.findByText("Couldn't sign you in. Try again.")).toBeInTheDocument()
    expect(googleButton()).toBeEnabled()
    await userEvent.click(googleButton())
    expect(startSocial).toHaveBeenCalledTimes(2)
  })

  it('re-enables the buttons when the page comes back from the bfcache', async () => {
    await renderPage()
    await googleShown()
    await userEvent.click(googleButton())
    expect(googleButton()).toBeDisabled()
    const notPersisted = new Event('pageshow') as PageTransitionEvent
    Object.defineProperty(notPersisted, 'persisted', { value: false })
    act(() => void window.dispatchEvent(notPersisted))
    expect(googleButton()).toBeDisabled()
    const persisted = new Event('pageshow') as PageTransitionEvent
    Object.defineProperty(persisted, 'persisted', { value: true })
    act(() => void window.dispatchEvent(persisted))
    await waitFor(() => expect(googleButton()).toBeEnabled())
    expect(continueButton()).toBeEnabled()
  })

  it('lands back on /signin in sign-in mode, for the link and for Google', async () => {
    await renderPage({ mode: 'returning', search: { plan: 'team', cycle: 'monthly' } })
    await googleShown()
    await userEvent.click(googleButton())
    expect(startSocial).toHaveBeenCalledWith('google', '/signin')
    act(() => {
      const event = new Event('pageshow') as PageTransitionEvent
      Object.defineProperty(event, 'persisted', { value: true })
      window.dispatchEvent(event)
    })
    await typeAndContinue('ana@acme.com')
    expect(sendLink).toHaveBeenCalledWith('ana@acme.com', '/signin')
  })
})

describe('refusalSearch', () => {
  it.each([
    [{}, {}],
    [{ error: 'INVALID_TOKEN' }, { error: 'INVALID_TOKEN' }],
    [
      { error: 1, via: 'google' },
      { error: '1', via: 'google' },
    ],
    [{ error: '' }, { error: '' }],
    [{ error: null, via: undefined }, {}],
  ])('reads %j as %j', async (search, expected) =>
    expect(refusalSearch.parse(search)).toEqual(expected),
  )

  it('shows the link refusal for an error the router parsed as a number', async () => {
    await renderPage({ search: refusalSearch.parse({ error: 1 }) })
    expect(screen.getByRole('alert')).toHaveTextContent('That link was already used or has expired')
  })
})
