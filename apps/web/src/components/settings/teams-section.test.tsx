import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { answer, answerAuth, meAs, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { TeamsSection } from './teams-section'

setupTestApi()

const ORG_ID = meAs().organization!.id
const OPS = { id: 'team-1', name: 'Ops', organizationId: ORG_ID }

const person = (userId: string, name: string, email: string) => ({
  userId,
  name,
  email,
  image: null,
})

const MEMBERS = {
  members: [
    {
      id: 'm-1',
      userId: 'u-1',
      role: 'owner',
      user: { id: 'u-1', name: 'Lucía Gómez', email: 'lucia@acme.com' },
    },
    {
      id: 'm-2',
      userId: 'u-2',
      role: 'member',
      user: { id: 'u-2', name: 'Marta', email: 'marta@acme.com' },
    },
  ],
  total: 2,
}

describe('TeamsSection', () => {
  it('lists the teams and their people, read-only to a member', async () => {
    answerAuth('organization/list-teams', [OPS])
    answer('teams/members', [person('u-1', 'Lucía Gómez', 'lucia@acme.com')])
    renderAt(<TeamsSection />, { me: meAs({ role: 'member' }) })
    const members = await screen.findByRole('list', { name: 'Members of Ops' })
    expect(await within(members).findByText('lucia@acme.com')).toBeInTheDocument()
    expect(screen.getByText('Ops')).toBeInTheDocument()
    expect(screen.queryByLabelText('Team name')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete Ops' })).toBeNull()
    expect(within(members).queryByRole('button')).toBeNull()
  })

  it('says when there are no teams', async () => {
    answerAuth('organization/list-teams', [])
    renderAt(<TeamsSection />)
    expect(await screen.findByText('No teams yet.')).toBeInTheDocument()
  })

  it('creates a team once, validating its name first', async () => {
    const created = answerAuth(
      'organization/create-team',
      async (input: Record<string, unknown>) => {
        await new Promise((r) => setTimeout(r, 30))
        return { id: 'team-2', name: input.name, organizationId: ORG_ID }
      },
    )
    answerAuth(
      'organization/list-teams',
      [],
      [{ id: 'team-2', name: 'Sales', organizationId: ORG_ID }],
    )
    answer('teams/members', [])
    answerAuth('organization/list-members', MEMBERS)
    renderAt(<TeamsSection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Create team' }))
    expect(await screen.findByText("Enter the team's name.")).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Team name'), ' Sales ')
    await userEvent.dblClick(screen.getByRole('button', { name: 'Create team' }))
    expect(await screen.findByText('Sales created.')).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'Members of Sales' })).toBeInTheDocument()
    expect(created).toEqual([{ input: { name: 'Sales', organizationId: ORG_ID } }])
  })

  it('renames, adds and takes people out, and deletes a team', async () => {
    const renamed = answerAuth('organization/update-team', { ...OPS, name: 'Operations' })
    const added = answerAuth('organization/add-team-member', { teamId: OPS.id, userId: 'u-2' })
    const removed = answerAuth('organization/remove-team-member', { message: 'ok' })
    const deleted = answerAuth('organization/remove-team', { message: 'ok' })
    answerAuth('organization/list-teams', [OPS], [{ ...OPS, name: 'Operations' }], [])
    answerAuth('organization/list-members', MEMBERS)
    answer(
      'teams/members',
      [person('u-1', 'Lucía Gómez', 'lucia@acme.com')],
      [person('u-1', 'Lucía Gómez', 'lucia@acme.com'), person('u-2', 'Marta', 'marta@acme.com')],
      [person('u-2', 'Marta', 'marta@acme.com')],
    )
    renderAt(<TeamsSection />)

    const name = await screen.findByRole('textbox', { name: 'Name of Ops' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Operations')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Team renamed to Operations.')).toBeInTheDocument()
    expect(renamed).toEqual([{ input: { teamId: OPS.id, data: { name: 'Operations' } } }])
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

    await userEvent.click(
      await screen.findByRole('combobox', { name: 'Add someone to Operations' }),
    )
    await userEvent.click(await screen.findByRole('option', { name: 'Marta' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('Marta added to Operations.')).toBeInTheDocument()
    expect(added).toEqual([{ input: { teamId: OPS.id, userId: 'u-2' } }])

    await userEvent.click(
      await screen.findByRole('button', { name: 'Take Lucía Gómez out of Operations' }),
    )
    expect(await screen.findByText('Lucía Gómez taken out of Operations.')).toBeInTheDocument()
    expect(removed).toEqual([{ input: { teamId: OPS.id, userId: 'u-1' } }])
    expect(screen.getByRole('button', { name: 'Take Marta out of Operations' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Delete Operations' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Operations?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete Operations' }))
    expect(await screen.findByText('Operations deleted.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('No teams yet.')).toBeInTheDocument())
    expect(deleted).toEqual([{ input: { teamId: OPS.id, organizationId: ORG_ID } }])
  })

  it("toasts the plugin's refusal in our words", async () => {
    quiet()
    answerAuth('organization/list-teams', [OPS])
    answerAuth('organization/list-members', MEMBERS)
    answer('teams/members', [])
    answerAuth('organization/create-team', [400, 'Team already exists', 'TEAM_ALREADY_EXISTS'])
    renderAt(<TeamsSection />)
    await userEvent.type(await screen.findByLabelText('Team name'), 'Ops')
    await userEvent.click(screen.getByRole('button', { name: 'Create team' }))
    expect(await screen.findByText('A team already has that name.')).toBeInTheDocument()
  })
})
