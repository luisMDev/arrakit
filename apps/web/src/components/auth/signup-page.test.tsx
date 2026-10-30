import type { AuthProviders } from '@arrakit/contract'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '#/i18n'

import { type AuthApi, AuthApiContext, EmailRefusedError } from './auth-api'
import { refusalSearch } from './sign-in-options'
import { SignupPage, type SignupSearch } from './signup-page'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (message: string) => toastError(message) } }))

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeApi(providers: AuthProviders = { google: true, microsoft: false }) {
  return {
    sendMagicLink: vi.fn<AuthApi['sendMagicLink']>(async () => undefined),
    signInWith: vi.fn<AuthApi['signInWith']>(() => new Promise<void>(() => undefined)),
    providers: vi.fn<AuthApi['providers']>(async () => providers),
  }
}

function renderPage(
  api: AuthApi,
  { mode = 'new', search = {} }: { mode?: 'new' | 'returning'; search?: SignupSearch } = {},
) {
  return render(
    <AuthApiContext.Provider value={api}>
      <SignupPage mode={mode} search={search} />
    </AuthApiContext.Provider>,
  )
}

const emailInput = () => screen.getByRole('textbox', { name: 'Work email' })
const continueButton = () => screen.getByRole('button', { name: 'Continue' })
const googleButton = () => screen.getByRole('button', { name: 'Continue with Google' })

async function typeAndContinue(email: string) {
  await userEvent.type(emailInput(), email)
  await userEvent.click(continueButton())
}

beforeEach(() => toastError.mockReset())

describe('SignupPage', () => {
  it('shows the copy and the form', async () => {
    renderPage(fakeApi())
    expect(
      screen.getByRole('heading', { level: 1, name: 'Where should we write to you?' }),
    ).toBeInTheDocument()
    expect(emailInput()).toHaveAttribute('type', 'email')
    expect(emailInput()).toHaveAttribute('autocomplete', 'email')
    expect(emailInput()).toHaveAttribute('placeholder', 'Your work email')
    expect(screen.getByText("No password. We'll email you a link to sign in.")).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(googleButton()).toBeInTheDocument())
  })

  it.each([
    [{ google: true, microsoft: true }, ['Google', 'Microsoft'], true],
    [{ google: true, microsoft: false }, ['Google'], true],
    [{ google: false, microsoft: true }, ['Microsoft'], true],
    [{ google: false, microsoft: false }, [], false],
  ])('shows the providers %j', async (providers, shown, divider) => {
    const api = fakeApi(providers)
    renderPage(api)
    await waitFor(() => expect(api.providers).toHaveBeenCalled())
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

  it('shows Google until the providers answer', () => {
    const api = fakeApi()
    api.providers.mockReturnValue(new Promise(() => undefined))
    renderPage(api)
    expect(googleButton()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue with Microsoft' })).toBeNull()
  })

  it.each([
    ['google', 'google', 'Google'],
    ['microsoft', 'microsoft', 'Microsoft'],
  ] as const)('starts %s with landing /profile and disables every button', async (via, _, name) => {
    const api = fakeApi({ google: true, microsoft: true })
    renderPage(api)
    const button = await screen.findByRole('button', { name: `Continue with ${name}` })
    await userEvent.click(button)
    expect(api.signInWith).toHaveBeenCalledWith(via, '/profile')
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
  ])('shows the refusal for %j', (search, message) => {
    renderPage(fakeApi(), { search })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent(message)
  })

  it('refuses an unwritable email on the client and sends nothing', async () => {
    const api = fakeApi()
    renderPage(api)
    await typeAndContinue('ana@acme')
    expect(emailInput()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter your work email, like name@company.com.')).toBeInTheDocument()
    expect(api.sendMagicLink).not.toHaveBeenCalled()
  })

  it('sends the normalized email and says check your email, without the input', async () => {
    const api = fakeApi()
    renderPage(api)
    await typeAndContinue('  Ana@Acme.COM ')
    expect(api.sendMagicLink).toHaveBeenCalledWith('ana@acme.com', '/profile')
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
    const api = fakeApi()
    const { unmount } = renderPage(api, { search: { plan: 'team', cycle: 'monthly' } })
    await typeAndContinue('ana@acme.com')
    expect(api.sendMagicLink).toHaveBeenLastCalledWith(
      'ana@acme.com',
      '/profile?plan=team&cycle=monthly',
    )
    unmount()
    renderPage(api, { search: { plan: 'enterprise', cycle: 'monthly' } })
    await typeAndContinue('ana@acme.com')
    expect(api.sendMagicLink).toHaveBeenLastCalledWith('ana@acme.com', '/profile')
  })

  it('goes back with the last email on Use a different email', async () => {
    renderPage(fakeApi())
    await typeAndContinue('ana@acme.com')
    await userEvent.click(await screen.findByRole('button', { name: 'Use a different email' }))
    expect(emailInput()).toHaveValue('ana@acme.com')
    expect(continueButton()).toBeEnabled()
  })

  it('shows the field error on an API 400 and re-enables the button', async () => {
    const api = fakeApi()
    api.sendMagicLink.mockRejectedValueOnce(new EmailRefusedError())
    renderPage(api)
    await typeAndContinue('iñigo@mesalia.es')
    expect(await screen.findByText('Enter your work email, like name@company.com.')).toBeVisible()
    expect(emailInput()).toHaveAttribute('aria-invalid', 'true')
    expect(continueButton()).toBeEnabled()
  })

  it('toasts another failure and lets the person retry', async () => {
    const api = fakeApi()
    api.sendMagicLink.mockRejectedValueOnce(new Error('500'))
    renderPage(api)
    await typeAndContinue('ana@acme.com')
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't send your link. Try again."),
    )
    expect(continueButton()).toBeEnabled()
    await userEvent.click(continueButton())
    expect(api.sendMagicLink).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('heading', { name: 'Check your email.' })).toBeInTheDocument()
  })

  it('sends one link while one is pending', async () => {
    const api = fakeApi()
    const pending = deferred()
    api.sendMagicLink.mockReturnValue(pending.promise)
    renderPage(api)
    await userEvent.type(emailInput(), 'ana@acme.com')
    await userEvent.click(continueButton())
    expect(continueButton()).toBeDisabled()
    expect(googleButton()).toBeDisabled()
    await userEvent.type(emailInput(), '{enter}')
    expect(api.sendMagicLink).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve())
  })

  it('starts Google once while pending and retries after a failure', async () => {
    const api = fakeApi()
    const start = deferred()
    api.signInWith.mockReturnValueOnce(start.promise)
    renderPage(api)
    await userEvent.click(googleButton())
    await userEvent.click(googleButton())
    expect(api.signInWith).toHaveBeenCalledTimes(1)
    await act(async () => start.reject(new Error('404')))
    expect(toastError).toHaveBeenCalledWith("Couldn't sign you in. Try again.")
    expect(googleButton()).toBeEnabled()
    await userEvent.click(googleButton())
    expect(api.signInWith).toHaveBeenCalledTimes(2)
  })

  it('re-enables the buttons when the page comes back from the bfcache', async () => {
    renderPage(fakeApi())
    await userEvent.click(googleButton())
    expect(googleButton()).toBeDisabled()
    const notPersisted = new Event('pageshow') as PageTransitionEvent
    Object.defineProperty(notPersisted, 'persisted', { value: false })
    act(() => void window.dispatchEvent(notPersisted))
    expect(googleButton()).toBeDisabled()
    const persisted = new Event('pageshow') as PageTransitionEvent
    Object.defineProperty(persisted, 'persisted', { value: true })
    act(() => void window.dispatchEvent(persisted))
    expect(googleButton()).toBeEnabled()
    expect(continueButton()).toBeEnabled()
  })

  it('lands back on /signin in sign-in mode, for the link and for Google', async () => {
    const api = fakeApi()
    renderPage(api, { mode: 'returning', search: { plan: 'team', cycle: 'monthly' } })
    await userEvent.click(googleButton())
    expect(api.signInWith).toHaveBeenCalledWith('google', '/signin')
    act(() => {
      const event = new Event('pageshow') as PageTransitionEvent
      Object.defineProperty(event, 'persisted', { value: true })
      window.dispatchEvent(event)
    })
    await typeAndContinue('ana@acme.com')
    expect(api.sendMagicLink).toHaveBeenCalledWith('ana@acme.com', '/signin')
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
  ])('reads %j as %j', (search, expected) => expect(refusalSearch(search)).toEqual(expected))

  it('shows the link refusal for an error the router parsed as a number', () => {
    renderPage(fakeApi(), { search: refusalSearch({ error: 1 }) })
    expect(screen.getByRole('alert')).toHaveTextContent('That link was already used or has expired')
  })
})
