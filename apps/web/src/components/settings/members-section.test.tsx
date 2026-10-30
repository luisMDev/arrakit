import { permissionsOf } from '@arrakit/auth/permissions'
import type { Me } from '@arrakit/contract'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { answer, answerAuth, meAs, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { MembersSection, assignableRoles, daysSince } from './members-section'
import { RoutedSettings } from './testing'

setupTestApi()

const ORG_ID = meAs().organization!.id

const member = (id: string, name: string, email: string, role: string) => ({
  id,
  organizationId: ORG_ID,
  userId: `user-${id}`,
  role,
  createdAt: new Date().toISOString(),
  user: { id: `user-${id}`, name, email, image: null },
})

const MEMBERS = [
  member('m-1', 'Lucía Gómez', 'lucia@acme.com', 'owner'),
  member('m-2', 'Javi', 'javi@acme.com', 'admin'),
  member('m-3', '', 'marta@acme.com', 'member'),
]

const invitation = (overrides: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  organizationId: ORG_ID,
  email: 'kim@acme.com',
  role: 'member',
  status: 'pending',
  inviterId: 'user-m-1',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  emailSent: true,
  ...overrides,
})

const FINANCE = {
  id: 'role-1',
  organizationId: ORG_ID,
  role: 'finance',
  permission: { billing: ['read'] },
}

function setup(
  me: Me = meAs(),
  {
    members = [{ members: MEMBERS, total: MEMBERS.length }] as unknown[],
    invitations = [[invitation()]] as unknown[],
    roles = [[FINANCE]] as unknown[],
  } = {},
) {
  const lists = {
    members: answerAuth('organization/list-members', ...members),
    invitations: answerAuth('organization/list-invitations', ...invitations),
    roles: answerAuth('organization/list-roles', ...roles),
  }
  return { ...renderAt(<MembersSection />, { me }), lists }
}

const row = async (email: string) => (await screen.findByText(email)).closest('li') as HTMLElement

describe('MembersSection', () => {
  it('counts members and offers more seats, opening Billing', async () => {
    answerAuth('organization/list-members', { members: MEMBERS, total: 3 })
    answerAuth('organization/list-invitations', [])
    answerAuth('organization/list-roles', [])
    answer('billing/get', 500)
    answer('usage/get', 500)
    quiet()
    renderAt(<RoutedSettings />, {
      me: meAs({ plan: 'pro' }),
      url: '/app/settings?section=members',
    })
    const seats = await screen.findByText(/3 members/)
    expect(seats).toHaveTextContent('3 members · Team has up to 10')
    await userEvent.click(within(seats).getByRole('link', { name: 'Team has up to 10' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Billing' })).toBeInTheDocument()
  })

  it('reads the lists of the active organization', async () => {
    const { lists } = setup()
    expect(await screen.findByText('3 members')).toBeInTheDocument()
    expect(lists.members[0]!.input).toEqual({ organizationId: ORG_ID })
    expect(lists.invitations[0]!.input).toEqual({ organizationId: ORG_ID })
  })

  it('lists members then pending invites, names by local part, and marks an unsent invite', async () => {
    setup(meAs(), {
      invitations: [
        [
          invitation(),
          invitation({ id: 'inv-2', email: 'zoe@acme.com', emailSent: false }),
          invitation({ id: 'inv-3', email: 'old@acme.com', status: 'canceled' }),
          invitation({ id: 'inv-4', email: 'gone@acme.com', expiresAt: '2020-01-01T00:00:00Z' }),
        ],
      ],
    })
    expect(await screen.findByText('marta')).toBeInTheDocument()
    expect(within(await row('kim@acme.com')).getByText('Invited today')).toBeInTheDocument()
    expect(within(await row('zoe@acme.com')).getByText('Email not sent')).toBeInTheDocument()
    expect(screen.queryByText('old@acme.com')).toBeNull()
    expect(screen.queryByText('gone@acme.com')).toBeNull()
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

  it('lets an admin change and remove members, never admins or the owner', async () => {
    setup(meAs({ role: 'admin', email: 'javi@acme.com', name: 'Javi' }))
    const marta = await row('marta@acme.com')
    expect(within(marta).getByRole('combobox', { name: 'Role of marta' })).toBeInTheDocument()
    expect(within(marta).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(within(await row('lucia@acme.com')).queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('renders nothing for a member', () => {
    const { container } = setup(meAs({ role: 'member' }))
    expect(container.querySelector('form')).toBeNull()
  })

  it('offers member, admin and custom roles to the owner, and labels custom roles by name', async () => {
    setup(meAs(), {
      members: [{ members: [...MEMBERS, member('m-4', 'Bo', 'bo@acme.com', 'finance')], total: 4 }],
    })
    expect(within(await row('bo@acme.com')).getByRole('combobox')).toHaveTextContent('finance')
    await userEvent.click(screen.getByRole('combobox', { name: 'Role' }))
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Member', 'Admin', 'finance'])
  })

  it('validates the email before calling the API', async () => {
    const calls = answerAuth('organization/invite-member', invitation())
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

  it('invites once on a double click into the chosen role, then lists the invite', async () => {
    const calls = answerAuth(
      'organization/invite-member',
      async (input: Record<string, unknown>) => {
        await new Promise((r) => setTimeout(r, 30))
        return invitation({ id: 'inv-9', email: input.email, role: input.role })
      },
    )
    setup(meAs(), {
      invitations: [[], [invitation({ id: 'inv-9', email: 'ana@acme.com', role: 'finance' })]],
    })
    const input = await screen.findByLabelText('Invite someone from your organization')
    await userEvent.type(input, ' ana@acme.com ')
    await userEvent.click(screen.getByRole('combobox', { name: 'Role' }))
    await userEvent.click(await screen.findByRole('option', { name: 'finance' }))
    await userEvent.dblClick(screen.getByRole('button', { name: 'Invite' }))
    expect(await screen.findByText('Invite sent to ana@acme.com.')).toBeInTheDocument()
    expect(calls).toEqual([
      { input: { email: 'ana@acme.com', role: 'finance', organizationId: ORG_ID } },
    ])
    expect(await row('ana@acme.com')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it("toasts the API's refusal and still lists an invite saved without its email", async () => {
    const report = quiet()
    const saved =
      'The invite to ana@acme.com is saved, but its email did not go out. Press Resend to send it again.'
    answerAuth('organization/invite-member', [503, saved])
    setup(meAs(), {
      invitations: [[], [invitation({ id: 'inv-3', email: 'ana@acme.com', emailSent: false })]],
    })
    const input = await screen.findByLabelText('Invite someone from your organization')
    await userEvent.type(input, 'ana@acme.com')
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }))
    expect(await screen.findByText(saved)).toBeInTheDocument()
    expect(within(await row('ana@acme.com')).getByText('Email not sent')).toBeInTheDocument()
    expect(report).toHaveBeenCalledWith('[org] failed', expect.anything())
  })

  it.each([
    [
      [
        403,
        "Your organization's Free plan includes 1 seat, all taken. Upgrade to invite more people.",
      ],
      "Your organization's Free plan includes 1 seat, all taken. Upgrade to invite more people.",
    ],
    [500, "Couldn't invite ana@acme.com. Try again."],
    [
      [
        400,
        'User is already invited to this organization',
        'USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION',
      ],
      "They're already invited.",
    ],
  ])(
    'toasts the API reason, our copy for its code, or the fallback (%j)',
    async (reply, message) => {
      quiet()
      answerAuth('organization/invite-member', reply)
      setup(meAs(), { invitations: [[]] })
      const input = await screen.findByLabelText('Invite someone from your organization')
      await userEvent.type(input, 'ana@acme.com')
      await userEvent.click(screen.getByRole('button', { name: 'Invite' }))
      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(input).toHaveValue('ana@acme.com')
    },
  )

  it('changes a role, and shows the refusal when the API says no', async () => {
    quiet()
    const changes = answerAuth('organization/update-member-role', {}, [
      403,
      'Only the owner names admins.',
    ])
    const promoted = MEMBERS.map((m) => (m.id === 'm-3' ? { ...m, role: 'admin' } : m))
    setup(meAs(), {
      members: [
        { members: MEMBERS, total: 3 },
        { members: promoted, total: 3 },
      ],
    })
    const select = within(await row('marta@acme.com')).getByRole('combobox', {
      name: 'Role of marta',
    })
    await userEvent.click(select)
    await userEvent.click(await screen.findByRole('option', { name: 'Admin' }))
    expect(await screen.findByText('marta is now an admin.')).toBeInTheDocument()
    await waitFor(() => expect(select).toHaveTextContent('Admin'))
    expect(changes[0]!.input).toEqual({ memberId: 'm-3', role: 'admin', organizationId: ORG_ID })

    const javi = within(await row('javi@acme.com')).getByRole('combobox', { name: 'Role of Javi' })
    await userEvent.click(javi)
    await userEvent.click(await screen.findByRole('option', { name: 'Member' }))
    expect(await screen.findByText('Only the owner names admins.')).toBeInTheDocument()
    expect(javi).toHaveTextContent('Admin')
  })

  it('removes a member once', async () => {
    const calls = answerAuth('organization/remove-member', { member: MEMBERS[2] })
    setup(meAs(), {
      members: [
        { members: MEMBERS, total: 3 },
        { members: MEMBERS.slice(0, 2), total: 2 },
      ],
    })
    await userEvent.dblClick(
      within(await row('marta@acme.com')).getByRole('button', { name: 'Remove' }),
    )
    expect(await screen.findByText('marta removed from Acme.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('marta@acme.com')).toBeNull())
    expect(calls).toEqual([{ input: { memberIdOrEmail: 'm-3', organizationId: ORG_ID } }])
  })

  it('toasts when a removal fails', async () => {
    quiet()
    answerAuth('organization/remove-member', 500)
    setup()
    await userEvent.click(
      within(await row('marta@acme.com')).getByRole('button', { name: 'Remove' }),
    )
    expect(await screen.findByText("Couldn't remove marta. Try again.")).toBeInTheDocument()
    expect(screen.getByText('marta@acme.com')).toBeInTheDocument()
  })

  it('resends an unsent invite, clearing its mark, and cancels another', async () => {
    const resent = answerAuth(
      'organization/invite-member',
      invitation({ id: 'inv-2', email: 'zoe@acme.com' }),
    )
    const cancelled = answerAuth(
      'organization/cancel-invitation',
      invitation({ status: 'canceled' }),
    )
    const zoe = invitation({ id: 'inv-2', email: 'zoe@acme.com', emailSent: false })
    setup(meAs(), {
      invitations: [
        [invitation(), zoe],
        [invitation(), { ...zoe, emailSent: true }],
        [{ ...zoe, emailSent: true }],
      ],
    })
    await userEvent.click(within(await row('zoe@acme.com')).getByRole('button', { name: 'Resend' }))
    expect(await screen.findByText('Invite sent again to zoe@acme.com.')).toBeInTheDocument()
    await waitFor(async () =>
      expect(within(await row('zoe@acme.com')).getByText('Invited today')).toBeInTheDocument(),
    )
    expect(resent[0]!.input).toEqual({
      email: 'zoe@acme.com',
      role: 'member',
      organizationId: ORG_ID,
      resend: true,
    })

    await userEvent.click(within(await row('kim@acme.com')).getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Invite to kim@acme.com cancelled.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('kim@acme.com')).toBeNull())
    expect(cancelled[0]!.input).toEqual({ invitationId: 'inv-1' })
  })

  it('toasts failed resends and cancels', async () => {
    quiet()
    answerAuth('organization/invite-member', 500)
    answerAuth('organization/cancel-invitation', 500)
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
    setup(meAs(), { members: [500] })
    expect(
      await screen.findByText("Couldn't load your organization's members. Reload the page."),
    ).toBeInTheDocument()
  })
})

describe('assignableRoles', () => {
  const custom = [
    { id: 'r-1', role: 'finance', permission: { billing: ['read'] } as const },
    { id: 'r-2', role: 'closer', permission: { organization: ['delete'] } as const },
  ]

  it('gives the owner every role but owner', () => {
    expect(assignableRoles('owner', permissionsOf('owner'), custom)).toEqual([
      'member',
      'admin',
      'finance',
      'closer',
    ])
  })

  it('keeps an admin to roles within their own permissions, never admin', () => {
    expect(assignableRoles('admin', permissionsOf('admin'), custom)).toEqual(['member', 'finance'])
  })
})

describe('daysSince', () => {
  it('counts calendar days', () => {
    const now = new Date(2026, 9, 30, 0, 30)
    expect(daysSince(new Date(2026, 9, 30, 0, 1), now)).toBe(0)
    expect(daysSince(new Date(2026, 9, 29, 23, 59), now)).toBe(1)
    expect(daysSince(new Date(2026, 9, 25, 12), now)).toBe(5)
  })
})
