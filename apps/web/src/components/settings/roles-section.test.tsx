import { permissionsOf } from '@arrakit/auth/permissions'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { answerAuth, meAs, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { RolesSection } from './roles-section'

setupTestApi()

const ORG_ID = meAs().organization!.id
const FINANCE = {
  id: 'role-1',
  organizationId: ORG_ID,
  role: 'finance',
  permission: { billing: ['read'] },
}

const dialog = () => screen.findByRole('dialog')
const box = (scope: HTMLElement, name: string) => within(scope).getByRole('checkbox', { name })

describe('RolesSection', () => {
  it('lists the built-in roles read-only and the custom ones with their permission count', async () => {
    answerAuth('organization/list-roles', [FINANCE])
    renderAt(<RolesSection />)
    expect(await screen.findByText('Owner, Admin, Member')).toBeInTheDocument()
    const finance = (await screen.findByText('finance')).closest('li')!
    expect(finance).toHaveTextContent('1 permission')
    expect(within(finance).getByRole('button', { name: 'Edit finance' })).toBeInTheDocument()
    expect(within(finance).getByRole('button', { name: 'Delete finance' })).toBeInTheDocument()
  })

  it('creates a role once from the ticked permissions, after checking the form', async () => {
    const created = answerAuth('organization/create-role', async () => {
      await new Promise((r) => setTimeout(r, 30))
      return { success: true }
    })
    answerAuth('organization/list-roles', [], [FINANCE])
    renderAt(<RolesSection />)
    await userEvent.click(await screen.findByRole('button', { name: 'New role' }))
    const form = await dialog()
    await userEvent.click(within(form).getByRole('button', { name: 'Create role' }))
    expect(await within(form).findByText("Enter the role's name.")).toBeInTheDocument()
    expect(within(form).getByText('Pick at least one permission.')).toBeInTheDocument()

    await userEvent.type(within(form).getByLabelText('Role name'), 'Finance')
    await userEvent.click(box(form, 'Billing: View'))
    await userEvent.dblClick(within(form).getByRole('button', { name: 'Create role' }))
    expect(await screen.findByText('Finance role created.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(created).toEqual([
      {
        input: { role: 'Finance', permission: { billing: ['read'] }, organizationId: ORG_ID },
      },
    ])
    expect(await screen.findByText('finance')).toBeInTheDocument()
  })

  it('offers an admin only the permissions they hold', async () => {
    answerAuth('organization/list-roles', [])
    renderAt(<RolesSection />, { me: meAs({ role: 'admin' }) })
    await userEvent.click(await screen.findByRole('button', { name: 'New role' }))
    const form = await dialog()
    expect(box(form, 'Billing: Manage')).toBeEnabled()
    expect(box(form, 'Organization: Change')).toBeEnabled()
    expect(box(form, 'Organization: Delete')).toBeDisabled()
  })

  it('edits a role, keeping its name', async () => {
    const updated = answerAuth('organization/update-role', { success: true })
    answerAuth('organization/list-roles', [FINANCE])
    renderAt(<RolesSection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit finance' }))
    const form = await dialog()
    expect(within(form).queryByLabelText('Role name')).toBeNull()
    expect(box(form, 'Billing: View')).toBeChecked()
    await userEvent.click(box(form, 'Billing: Manage'))
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('finance role saved.')).toBeInTheDocument()
    expect(updated).toEqual([
      {
        input: {
          roleId: 'role-1',
          organizationId: ORG_ID,
          data: { permission: { billing: ['read', 'manage'] } },
        },
      },
    ])
  })

  it.each([
    [
      [400, 'Cannot delete a role that is assigned to members', 'ROLE_IS_ASSIGNED_TO_MEMBERS'],
      'Someone has this role. Give them another role first.',
    ],
    [500, "Couldn't delete the role. Try again."],
  ])('toasts a refused delete (%j)', async (reply, message) => {
    quiet()
    answerAuth('organization/list-roles', [FINANCE])
    const deleted = answerAuth('organization/delete-role', reply)
    renderAt(<RolesSection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete finance' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete the finance role?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete finance' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(deleted).toEqual([{ input: { roleId: 'role-1', organizationId: ORG_ID } }])
  })

  it('deletes a role', async () => {
    answerAuth('organization/list-roles', [FINANCE], [])
    answerAuth('organization/delete-role', { success: true })
    renderAt(<RolesSection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete finance' }))
    const confirm = await screen.findByRole('alertdialog')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete finance' }))
    expect(await screen.findByText('finance role deleted.')).toBeInTheDocument()
    expect(await screen.findByText('No custom roles yet.')).toBeInTheDocument()
  })

  it('lets a member read the roles but not change them', async () => {
    answerAuth('organization/list-roles', [FINANCE])
    renderAt(<RolesSection />, {
      me: meAs({ role: 'member', permissions: permissionsOf('member') }),
    })
    expect(await screen.findByText('finance')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New role' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit finance' })).toBeNull()
  })
})
