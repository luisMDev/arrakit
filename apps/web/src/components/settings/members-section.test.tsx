import type { InvitationView, Me } from '@arrakit/contract'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { answer, api, meAs, quiet, renderAt } from '#/test/rpc'

import { MembersSection, daysSince } from './members-section'
import { SettingsPage } from './settings-page'

beforeAll(() => api.listen({ onUnhandledFrame: 'bypass' }))
afterEach(() => {
  api.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => api.close())

const today = new Date().toISOString().slice(0, 10)

const MEMBERS = [
  { name: 'Lucía Gómez', email: 'lucia@acme.com', role: 'owner' },
  { name: 'Javi', email: 'javi@acme.com', role: 'admin' },
  { name: '', email: 'marta@acme.com', role: 'member' },
]

const invitation = (overrides: Partial<InvitationView> = {}): InvitationView => ({
  id: 'inv-1',
  email: 'kim@acme.com',
  role: 'member',
  invitedOn: today,
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  emailSent: true,
  ...overrides,
})

function setup(me: Me = meAs(), members: unknown = MEMBERS, invitations: unknown = [invitation()]) {
  answer('members/list', members)
  answer('invitations/list', invitations)
  return renderAt(<MembersSection open={() => undefined} />, { me })
}

const row = async (email: string) => (await screen.findByText(email)).closest('li') as HTMLElement

describe('MembersSection', () => {
  it('counts members and offers more seats, opening Billing', async () => {
    answer('members/list', MEMBERS)
    answer('invitations/list', [])
    renderAt(<SettingsPage section="members" />, { me: meAs({ plan: 'pro' }) })
    const seats = await screen.findByText(/3 members/)
    expect(seats).toHaveTextContent('3 members · Team has up to 10')
    await userEvent.click(within(seats).getByRole('button', { name: 'Team has up to 10' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Billing' })).toBeInTheDocument()
  })

  it('offers no bigger plan on Team', async () => {
    setup()
    expect(await screen.findByText('3 members')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /has up to/ })).toBeNull()
  })

  it('lists members then invites, names by local part, and marks an unsent invite', async () => {
    setup(meAs(), MEMBERS, [
      invitation(),
      invitation({ id: 'inv-2', email: 'zoe@acme.com', emailSent: false }),
    ])
    expect(await screen.findByText('marta')).toBeInTheDocument()
    expect(within(await row('kim@acme.com')).getByText('Invited today')).toBeInTheDocument()
    expect(within(await row('zoe@acme.com')).getByText('Email not sent')).toBeInTheDocument()
  })

  it('gives the owner a role select and Remove for admins and members, never self', async () => {
    setup()
    expect(
      within(await row('javi@acme.com')).getByRole('combobox', { name: 'Role of Javi' }),
    ).toBeInTheDocument()
    expect(
      within(await row('marta@acme.com')).getByRole('button', { name: 'Remove' }),
    ).toBeInTheDocument()
    const mine = await row('lucia@acme.com')
    expect(within(mine).queryByRole('combobox')).toBeNull()
    expect(within(mine).queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(within(mine).getByText('Owner')).toBeInTheDocument()
  })

  it('lets an admin remove members only, with no role select', async () => {
    setup(meAs({ role: 'admin', email: 'javi@acme.com', name: 'Javi' }))
    const marta = await row('marta@acme.com')
    expect(within(marta).queryByRole('combobox')).toBeNull()
    expect(within(marta).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(within(await row('lucia@acme.com')).queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('renders nothing for a member', () => {
    const { container } = setup(meAs({ role: 'member' }))
    expect(container.querySelector('form')).toBeNull()
  })

  it('validates the email before calling the API', async () => {
    const calls = answer('invitations/invite', invitation())
    setup()
    const input = await screen.findByLabelText('Invite someone from your organization')
    expect(input).toHaveAttribute('placeholder', 'name@acme.com')
    const invite = screen.getByRole('button', { name: 'Invite' })

    await userEvent.type(input, 'lucia@cierzo')
    await userEvent.click(invite)
    expect(screen.getByText('Enter their work email, like name@acme.com.')).toBeInTheDocument()

    await userEvent.clear(input)
    expect(screen.queryByText(/Enter their work email/)).toBeNull()
    await userEvent.type(input, 'MARTA@acme.com')
    await userEvent.click(invite)
    expect(screen.getByText('marta@acme.com is already in the organization.')).toBeInTheDocument()

    await userEvent.clear(input)
    await userEvent.type(input, 'kim@acme.com')
    await userEvent.click(invite)
    expect(screen.getByText('kim@acme.com is already invited.')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('invites once on a double click, adds the invite and toasts', async () => {
    const calls = answer('invitations/invite', async (input: unknown) => {
      await new Promise((r) => setTimeout(r, 30))
      return invitation({ id: 'inv-9', email: (input as { email: string }).email, role: 'admin' })
    })
    setup(meAs(), MEMBERS, [])
    const input = await screen.findByLabelText('Invite someone from your organization')
    await userEvent.type(input, ' ana@acme.com ')
    await userEvent.click(screen.getByRole('combobox', { name: 'Role' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Admin' }))
    await userEvent.dblClick(screen.getByRole('button', { name: 'Invite' }))
    expect(await screen.findByText('Invite sent to ana@acme.com.')).toBeInTheDocument()
    expect(calls).toEqual([{ input: { email: 'ana@acme.com', role: 'admin' } }])
    expect(await row('ana@acme.com')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('warns when the invite was saved but its email did not go out', async () => {
    answer(
      'invitations/invite',
      invitation({ id: 'inv-3', email: 'ana@acme.com', emailSent: false }),
    )
    setup(meAs(), MEMBERS, [])
    await userEvent.type(
      await screen.findByLabelText('Invite someone from your organization'),
      'ana@acme.com',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }))
    expect(
      await screen.findByText(
        "The invite to ana@acme.com is saved, but the email didn't go out. Resend it from the list.",
      ),
    ).toBeInTheDocument()
    expect(within(await row('ana@acme.com')).getByText('Email not sent')).toBeInTheDocument()
  })

  it.each([
    [
      [403, 'Your organization’s Free plan is full.'] as const,
      'Your organization’s Free plan is full.',
    ],
    [503, "Couldn't invite ana@acme.com. Try again."],
  ])('toasts the API reason or the fallback (%j), keeping the email', async (reply, message) => {
    const report = quiet()
    answer('invitations/invite', reply as number | [number, string])
    setup(meAs(), MEMBERS, [])
    const input = await screen.findByLabelText('Invite someone from your organization')
    await userEvent.type(input, 'ana@acme.com')
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(input).toHaveValue('ana@acme.com')
    expect(report).toHaveBeenCalledWith('[members] inviting failed', expect.anything())
  })

  it('changes a role, and puts the select back when refused', async () => {
    quiet()
    answer('members/changeRole', { name: '', email: 'marta@acme.com', role: 'admin' }, [
      403,
      'Only the owner names admins.',
    ])
    setup()
    const select = within(await row('marta@acme.com')).getByRole('combobox', {
      name: 'Role of marta',
    })
    await userEvent.click(select)
    await userEvent.click(await screen.findByRole('option', { name: 'Admin' }))
    expect(await screen.findByText('marta is now an admin.')).toBeInTheDocument()
    expect(select).toHaveTextContent('Admin')

    const javi = within(await row('javi@acme.com')).getByRole('combobox', { name: 'Role of Javi' })
    await userEvent.click(javi)
    await userEvent.click(await screen.findByRole('option', { name: 'Member' }))
    expect(await screen.findByText('Only the owner names admins.')).toBeInTheDocument()
    expect(javi).toHaveTextContent('Admin')
  })

  it('removes a member once', async () => {
    const calls = answer('members/remove', null)
    setup()
    await userEvent.dblClick(
      within(await row('marta@acme.com')).getByRole('button', { name: 'Remove' }),
    )
    expect(await screen.findByText('marta removed from Acme.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('marta@acme.com')).toBeNull())
    expect(calls).toEqual([{ input: { email: 'marta@acme.com' } }])
  })

  it('toasts when a removal fails', async () => {
    quiet()
    answer('members/remove', 500)
    setup()
    await userEvent.click(
      within(await row('marta@acme.com')).getByRole('button', { name: 'Remove' }),
    )
    expect(await screen.findByText("Couldn't remove marta. Try again.")).toBeInTheDocument()
    expect(screen.getByText('marta@acme.com')).toBeInTheDocument()
  })

  it('resends an unsent invite, clearing its mark, and cancels another', async () => {
    answer('invitations/resend', invitation({ id: 'inv-2', email: 'zoe@acme.com' }))
    answer('invitations/cancel', null)
    setup(meAs(), MEMBERS, [
      invitation(),
      invitation({ id: 'inv-2', email: 'zoe@acme.com', emailSent: false }),
    ])
    const zoe = await row('zoe@acme.com')
    await userEvent.click(within(zoe).getByRole('button', { name: 'Resend' }))
    expect(await screen.findByText('Invite sent again to zoe@acme.com.')).toBeInTheDocument()
    expect(within(await row('zoe@acme.com')).getByText('Invited today')).toBeInTheDocument()

    await userEvent.click(within(await row('kim@acme.com')).getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Invite to kim@acme.com cancelled.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('kim@acme.com')).toBeNull())
  })

  it('toasts failed resends and cancels', async () => {
    quiet()
    answer('invitations/resend', 500)
    answer('invitations/cancel', 500)
    setup()
    const kim = await row('kim@acme.com')
    await userEvent.click(within(kim).getByRole('button', { name: 'Resend' }))
    expect(
      await screen.findByText("Couldn't send the invite again. Try again."),
    ).toBeInTheDocument()
    await userEvent.click(within(kim).getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText("Couldn't cancel the invite. Try again.")).toBeInTheDocument()
  })

  it('toasts when the lists do not load', async () => {
    quiet()
    setup(meAs(), 500, [])
    expect(
      await screen.findByText("Couldn't load your organization's members. Reload the page."),
    ).toBeInTheDocument()
  })
})

describe('daysSince', () => {
  it('counts calendar days', () => {
    const now = new Date(2026, 9, 30, 0, 30)
    expect(daysSince('2026-10-30', now)).toBe(0)
    expect(daysSince('2026-10-29', now)).toBe(1)
    expect(daysSince('2026-10-25', now)).toBe(5)
  })
})
