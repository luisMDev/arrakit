import type { AccountView } from '@arrakit/contract'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { i18n, loadLanguage } from '#/i18n'
import { orpc } from '#/lib/orpc'
import { answer, answerAuth, meAs, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { AccountSection, devicesLine } from './account-section'
import { SettingsPage, settingsSearch } from './settings-page'

setupTestApi()
afterEach(async () => {
  await loadLanguage('en')
})

const SAVED = { status: true }

const ACCOUNT: AccountView = {
  name: 'Ana',
  email: 'ana@acme.com',
  signInWith: 'email',
  devices: ['Mac', 'iPhone'],
  language: 'en',
  timeZone: 'Europe/Madrid',
  emails: { productNews: false },
}

function setup(account: Partial<AccountView> = {}, role: 'owner' | 'admin' | 'member' = 'member') {
  answer('me/account/get', { ...ACCOUNT, ...account })
  return renderAt(<AccountSection />, {
    me: meAs({ role, email: 'ana@acme.com', name: 'Ana' }),
  })
}

describe('devicesLine', () => {
  const t = (key: string, params?: Record<string, unknown>) => i18n.t(key, params)
  it.each([
    [[], 'No device'],
    [['Mac'], 'This Mac'],
    [['Mac', 'iPhone'], 'This Mac and an iPhone'],
    [['iPhone', 'Mac', 'Windows PC'], 'This iPhone, a Mac, and a Windows PC'],
  ])('%j -> %s', (devices, line) => {
    expect(devicesLine(devices, t)).toBe(line)
  })
})

describe('AccountSection', () => {
  it('shows the account', async () => {
    setup({ signInWith: 'google' })
    expect(await screen.findByLabelText('Your name')).toHaveValue('Ana')
    expect(screen.getByText('ana@acme.com')).toBeInTheDocument()
    expect(screen.getByText('Google')).toBeInTheDocument()
    expect(screen.getByText('This Mac and an iPhone')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('English')
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveTextContent(
      'Central European Time (Madrid)',
    )
    expect(screen.getByRole('switch', { name: /Product news/ })).not.toBeChecked()
  })

  it('fills a missing time zone from the browser', async () => {
    const calls = answerAuth('update-user', SAVED)
    setup({ timeZone: null })
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    await waitFor(() => expect(calls).toEqual([{ input: { timeZone: zone } }]))
  })

  it('only reports a failed save of the browser zone: no toast, account kept', async () => {
    const errors = quiet()
    const calls = answerAuth('update-user', 500)
    setup({ timeZone: null })
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    await waitFor(() => expect(calls).toEqual([{ input: { timeZone: zone } }]))
    await waitFor(() => expect(errors).toHaveBeenCalled())
    expect(String(errors.mock.calls[0]?.[0])).toContain('[account]')
    expect(screen.queryByText("Couldn't save your settings. Try again.")).toBeNull()
    expect(screen.getByLabelText('Your name')).toHaveValue('Ana')
    expect(calls).toHaveLength(1)
  })

  it('shows the email local part as the name of a person without one', async () => {
    const calls = answerAuth('update-user', SAVED)
    setup({ name: '  ', email: 'lucia.gomez@acme.com' })
    const input = await screen.findByLabelText('Your name')
    expect(input).toHaveValue('lucia.gomez')
    expect(screen.getByText('L')).toBeInTheDocument()
    await userEvent.click(input)
    await userEvent.tab()
    expect(calls).toHaveLength(0)
  })

  it('lists a saved zone missing from the picker under its own name', async () => {
    setup({ timeZone: 'Asia/Kolkata' })
    expect(await screen.findByRole('combobox', { name: 'Time zone' })).toHaveTextContent(
      'Asia/Kolkata',
    )
  })

  it('saves the name on blur, trimmed, and patches me', async () => {
    const calls = answerAuth('update-user', SAVED)
    const { queryClient } = setup()
    answer('me/account/get', ACCOUNT, { ...ACCOUNT, name: 'Ana Pérez' })
    const input = await screen.findByLabelText('Your name')
    await userEvent.clear(input)
    await userEvent.type(input, '  Ana Pérez ')
    await userEvent.tab()
    await waitFor(() => expect(calls).toEqual([{ input: { name: 'Ana Pérez' } }]))
    await waitFor(() =>
      expect(queryClient.getQueryData(orpc.me.get.queryOptions().queryKey)).toMatchObject({
        name: 'Ana Pérez',
      }),
    )
    expect(input).toHaveValue('Ana Pérez')
  })

  it('refuses a blank name without saving', async () => {
    const calls = answerAuth('update-user', SAVED)
    setup()
    const input = await screen.findByLabelText('Your name')
    await userEvent.clear(input)
    await userEvent.type(input, '   ')
    await userEvent.tab()
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('does not save an unchanged name', async () => {
    const calls = answerAuth('update-user', SAVED)
    setup()
    await userEvent.click(await screen.findByLabelText('Your name'))
    await userEvent.tab()
    expect(calls).toHaveLength(0)
  })

  it('switches the language without a reload', async () => {
    const calls = answerAuth('update-user', SAVED)
    setup()
    await userEvent.click(await screen.findByRole('combobox', { name: 'Language' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Español' }))
    expect(await screen.findByRole('heading', { name: 'Cuenta' })).toBeInTheDocument()
    expect(calls).toEqual([{ input: { language: 'es' } }])
  })

  it('saves the time zone and the product news choice', async () => {
    const calls = answerAuth('update-user', SAVED)
    setup()
    await userEvent.click(await screen.findByRole('combobox', { name: 'Time zone' }))
    await userEvent.click(await screen.findByRole('option', { name: 'UK Time (London)' }))
    await userEvent.click(screen.getByRole('switch', { name: /Product news/ }))
    await waitFor(() =>
      expect(calls).toEqual([
        { input: { timeZone: 'Europe/London' } },
        { input: { emailProductNews: true } },
      ]),
    )
  })

  it('puts the setting back when a save fails', async () => {
    quiet()
    answerAuth('update-user', 500)
    setup()
    await userEvent.click(await screen.findByRole('switch', { name: /Product news/ }))
    expect(await screen.findByText("Couldn't save your settings. Try again.")).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Product news/ })).not.toBeChecked(),
    )
  })

  it('saves one change at a time, in order, showing each choice at once', async () => {
    const gates: Array<() => void> = []
    const calls = answerAuth(
      'update-user',
      () => new Promise((resolve) => gates.push(() => resolve(SAVED))),
      SAVED,
    )
    answer('me/account/get', ACCOUNT, {
      ...ACCOUNT,
      timeZone: 'Europe/London',
      emails: { productNews: true },
    })
    renderAt(<AccountSection />, {
      me: meAs({ role: 'member', email: 'ana@acme.com', name: 'Ana' }),
    })
    await userEvent.click(await screen.findByRole('combobox', { name: 'Time zone' }))
    await userEvent.click(await screen.findByRole('option', { name: 'UK Time (London)' }))
    await userEvent.click(screen.getByRole('switch', { name: /Product news/ }))
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveTextContent('London')
    expect(screen.getByRole('switch', { name: /Product news/ })).toBeChecked()
    await waitFor(() => expect(calls).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toEqual([{ input: { timeZone: 'Europe/London' } }])
    gates[0]!()
    await waitFor(() =>
      expect(calls).toEqual([
        { input: { timeZone: 'Europe/London' } },
        { input: { emailProductNews: true } },
      ]),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByRole('switch', { name: /Product news/ })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveTextContent('London')
  })

  it('saves the change queued behind a failed one, then shows what the server kept', async () => {
    quiet()
    let fail: () => void = () => undefined
    const calls = answerAuth(
      'update-user',
      () => new Promise((resolve) => (fail = () => resolve(new Response(null, { status: 500 })))),
      SAVED,
    )
    answer('me/account/get', ACCOUNT, { ...ACCOUNT, timeZone: 'Europe/London' })
    renderAt(<AccountSection />, {
      me: meAs({ role: 'member', email: 'ana@acme.com', name: 'Ana' }),
    })
    await userEvent.click(await screen.findByRole('switch', { name: /Product news/ }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Time zone' }))
    await userEvent.click(await screen.findByRole('option', { name: 'UK Time (London)' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    fail()
    expect(await screen.findByText("Couldn't save your settings. Try again.")).toBeInTheDocument()
    await waitFor(() =>
      expect(calls).toEqual([
        { input: { emailProductNews: true } },
        { input: { timeZone: 'Europe/London' } },
      ]),
    )
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Product news/ })).not.toBeChecked(),
    )
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveTextContent('London')
  })

  it('toasts when the account does not load', async () => {
    quiet()
    answer('me/account/get', 500)
    renderAt(<AccountSection />)
    expect(
      await screen.findByText("Couldn't load your account. Reload the page."),
    ).toBeInTheDocument()
  })

  it('signs out everywhere once and reloads the devices', async () => {
    let resolve: (value: unknown) => void = () => undefined
    const revoked = answerAuth('revoke-other-sessions', () => new Promise((r) => (resolve = r)))
    answer('me/account/get', ACCOUNT, { ...ACCOUNT, devices: ['Mac'] })
    renderAt(<AccountSection />)
    const button = await screen.findByRole('button', { name: 'Sign out everywhere' })
    await userEvent.dblClick(button)
    expect(button).toBeDisabled()
    await waitFor(() => expect(revoked).toHaveLength(1))
    resolve(SAVED)
    expect(await screen.findByText('Signed out on your other devices.')).toBeInTheDocument()
    expect(await screen.findByText('This Mac')).toBeInTheDocument()
    expect(revoked).toHaveLength(1)
  })

  it('says so when the account does not reload after signing out everywhere', async () => {
    quiet()
    answerAuth('revoke-other-sessions', SAVED)
    const loads = answer('me/account/get', ACCOUNT, 500)
    renderAt(<AccountSection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }))
    expect(await screen.findByText('Signed out on your other devices.')).toBeInTheDocument()
    expect(
      await screen.findByText("Couldn't load your account. Reload the page."),
    ).toBeInTheDocument()
    expect(loads).toHaveLength(2)
    expect(screen.getByText('This Mac and an iPhone')).toBeInTheDocument()
  })

  it('keeps the devices when signing out everywhere fails', async () => {
    quiet()
    answerAuth('revoke-other-sessions', 500)
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }))
    expect(
      await screen.findByText("Couldn't sign out your other devices. Try again."),
    ).toBeInTheDocument()
    expect(screen.getByText('This Mac and an iPhone')).toBeInTheDocument()
  })

  it('tells an owner to delete the organization first, linking to Security', async () => {
    answer('me/account/get', ACCOUNT)
    renderAt((search) => <SettingsPage section={settingsSearch.parse(search).section} />, {
      me: meAs({ role: 'owner' }),
    })
    expect(await screen.findByText(/You own this organization/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    const owned = screen.getByText(/You own this organization/)
    await userEvent.click(within(owned).getByRole('link', { name: 'Security and data' }))
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Security and data' }),
    ).toBeInTheDocument()
  })

  it('deletes the account after confirming and opens Sign in, signed out', async () => {
    const calls = answerAuth('delete-user', { success: true, message: 'User deleted' })
    const signedOut = answerAuth('sign-out', { success: true })
    const { location, queryClient } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete your account?' })
    expect(within(dialog).getByText("This can't be undone.")).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete your account' }))
    expect(await screen.findByText('Your account is deleted.')).toBeInTheDocument()
    await waitFor(() => expect(location()).toBe('/signin'))
    expect(calls).toHaveLength(1)
    expect(signedOut).toEqual([])
    expect(queryClient.getQueryData(orpc.me.get.queryOptions().queryKey)).toBeUndefined()
  })

  it('keeps the dialog on Keep it', async () => {
    const calls = answerAuth('delete-user', { success: true })
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Keep it' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls).toHaveLength(0)
  })

  it.each([
    [
      [409, 'You own an organization. Delete it first.'] as const,
      'You own an organization. Delete it first.',
    ],
    [
      [400, 'Session expired. Re-authenticate to perform this action.', 'SESSION_EXPIRED'] as const,
      'For your security, sign out and sign in again, then delete your account.',
    ],
    [500, "Couldn't delete your account. Try again."],
  ])('toasts a refused delete (%j) and stays', async (reply, message) => {
    quiet()
    answerAuth('delete-user', reply)
    const { location } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete your account' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(location()).toBe('/app/settings')
  })
})
