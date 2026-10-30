import type { AccountView } from '@arrakit/contract'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { i18n, loadLanguage } from '#/i18n'
import { orpc } from '#/lib/orpc'

import { AccountSection, devicesLine } from './account-section'
import { SettingsPage } from './settings-page'
import { answer, api, meAs, renderScreen } from './testing'

const auth = vi.hoisted(() => ({
  revokeOtherSessions: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('#/lib/auth-client', () => ({ authClient: auth }))

beforeAll(() => api.listen({ onUnhandledFrame: 'bypass' }))
afterEach(async () => {
  api.resetHandlers()
  vi.restoreAllMocks()
  auth.revokeOtherSessions.mockReset()
  auth.signOut.mockReset()
  await loadLanguage('en')
})
afterAll(() => api.close())

const ACCOUNT: AccountView = {
  name: 'Ana',
  email: 'ana@acme.com',
  signInWith: 'email',
  devices: ['Mac', 'iPhone'],
  language: 'en',
  timeZone: 'Europe/Madrid',
  emails: { productNews: false },
}

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined)

function setup(account: Partial<AccountView> = {}, role: 'owner' | 'admin' | 'member' = 'member') {
  answer('me/account/get', { ...ACCOUNT, ...account })
  return renderScreen(<AccountSection open={() => undefined} />, {
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
    expect(devicesLine(devices, t, 'en')).toBe(line)
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
    const calls = answer('me/account/update', (input: unknown) => ({
      ...ACCOUNT,
      ...(input as object),
    }))
    setup({ timeZone: null })
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    await waitFor(() => expect(calls).toEqual([{ input: { timeZone: zone } }]))
  })

  it('only reports a failed save of the browser zone: no toast, account kept', async () => {
    const errors = quiet()
    const calls = answer('me/account/update', 500)
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
    const calls = answer('me/account/update', ACCOUNT)
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
    const calls = answer('me/account/update', { ...ACCOUNT, name: 'Ana Pérez' })
    const { queryClient } = setup()
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
    const calls = answer('me/account/update', ACCOUNT)
    setup()
    const input = await screen.findByLabelText('Your name')
    await userEvent.clear(input)
    await userEvent.type(input, '   ')
    await userEvent.tab()
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('does not save an unchanged name', async () => {
    const calls = answer('me/account/update', ACCOUNT)
    setup()
    await userEvent.click(await screen.findByLabelText('Your name'))
    await userEvent.tab()
    expect(calls).toHaveLength(0)
  })

  it('switches the language without a reload', async () => {
    const calls = answer('me/account/update', { ...ACCOUNT, language: 'es' })
    setup()
    await userEvent.click(await screen.findByRole('combobox', { name: 'Language' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Español' }))
    expect(await screen.findByRole('heading', { name: 'Cuenta' })).toBeInTheDocument()
    expect(calls).toEqual([{ input: { language: 'es' } }])
  })

  it('saves the time zone and the product news choice', async () => {
    const calls = answer('me/account/update', (input: unknown) => ({
      ...ACCOUNT,
      ...(input as object),
    }))
    setup()
    await userEvent.click(await screen.findByRole('combobox', { name: 'Time zone' }))
    await userEvent.click(await screen.findByRole('option', { name: 'UK Time (London)' }))
    await userEvent.click(screen.getByRole('switch', { name: /Product news/ }))
    await waitFor(() =>
      expect(calls).toEqual([
        { input: { timeZone: 'Europe/London' } },
        { input: { emails: { productNews: true } } },
      ]),
    )
  })

  it('puts the setting back when a save fails', async () => {
    quiet()
    answer('me/account/update', 500)
    setup()
    await userEvent.click(await screen.findByRole('switch', { name: /Product news/ }))
    expect(await screen.findByText("Couldn't save your settings. Try again.")).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Product news/ })).not.toBeChecked(),
    )
  })

  it('toasts when the account does not load', async () => {
    quiet()
    answer('me/account/get', 500)
    renderScreen(<AccountSection open={() => undefined} />)
    expect(
      await screen.findByText("Couldn't load your account. Reload the page."),
    ).toBeInTheDocument()
  })

  it('signs out everywhere once and reloads the devices', async () => {
    let resolve: (value: unknown) => void = () => undefined
    auth.revokeOtherSessions.mockReturnValue(new Promise((r) => (resolve = r)))
    answer('me/account/get', ACCOUNT, { ...ACCOUNT, devices: ['Mac'] })
    renderScreen(<AccountSection open={() => undefined} />)
    const button = await screen.findByRole('button', { name: 'Sign out everywhere' })
    await userEvent.dblClick(button)
    expect(button).toBeDisabled()
    resolve({ data: { status: true }, error: null })
    expect(await screen.findByText('Signed out on your other devices.')).toBeInTheDocument()
    expect(await screen.findByText('This Mac')).toBeInTheDocument()
    expect(auth.revokeOtherSessions).toHaveBeenCalledTimes(1)
  })

  it('keeps the devices when signing out everywhere fails', async () => {
    quiet()
    auth.revokeOtherSessions.mockResolvedValue({ data: null, error: { status: 500 } })
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }))
    expect(
      await screen.findByText("Couldn't sign out your other devices. Try again."),
    ).toBeInTheDocument()
    expect(screen.getByText('This Mac and an iPhone')).toBeInTheDocument()
  })

  it('tells an owner to delete the organization first, linking to Security', async () => {
    answer('me/account/get', ACCOUNT)
    renderScreen(<SettingsPage section="account" />, { me: meAs({ role: 'owner' }) })
    expect(await screen.findByText(/You own this organization/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    const owned = screen.getByText(/You own this organization/)
    await userEvent.click(within(owned).getByRole('button', { name: 'Security and data' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Security and data' })).toBeInTheDocument()
  })

  it('deletes the account after confirming, signs out and opens Sign in', async () => {
    const calls = answer('me/delete', null)
    auth.signOut.mockRejectedValue(new Error('gone'))
    const { location, queryClient } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete your account?' })
    expect(within(dialog).getByText("This can't be undone.")).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete your account' }))
    expect(await screen.findByText('Your account is deleted.')).toBeInTheDocument()
    await waitFor(() => expect(location()).toBe('/signin'))
    expect(calls).toHaveLength(1)
    expect(queryClient.getQueryData(orpc.me.get.queryOptions().queryKey)).toBeUndefined()
  })

  it('keeps the dialog on Keep it', async () => {
    const calls = answer('me/delete', null)
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
    [500, "Couldn't delete your account. Try again."],
  ])('toasts a refused delete (%j) and stays', async (reply, message) => {
    quiet()
    answer('me/delete', reply as number | [number, string])
    const { location } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete your account' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(location()).toBe('/app/settings')
    expect(auth.signOut).not.toHaveBeenCalled()
  })
})
