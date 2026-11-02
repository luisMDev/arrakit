import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { orpc } from '#/lib/orpc'
import { answer, answerAuth, meAs, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { OrgSwitcher } from './org-switcher'

setupTestApi()

const ACME = meAs().organization!
const BIRCH = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Birch',
  slug: 'birch',
  plan: 'free' as const,
}

const open = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Organization: Acme' }))
  return screen.findByRole('menu')
}

describe('OrgSwitcher', () => {
  it('shows the organization and its plan, and lists every organization with the current one checked', async () => {
    answerAuth('organization/list', [ACME, BIRCH])
    renderAt(<OrgSwitcher />, { url: '/app' })
    expect(await screen.findByRole('button', { name: 'Organization: Acme' })).toHaveTextContent(
      'Acme · Team',
    )
    const menu = await open()
    expect(await within(menu).findByRole('menuitemradio', { name: /Birch/ })).toHaveTextContent(
      'BirchFree',
    )
    expect(within(menu).getByRole('menuitemradio', { name: /Acme/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(menu).getByRole('menuitem', { name: 'Create organization' })).toBeInTheDocument()
  })

  it('switches organization, reloads the screens and opens the app', async () => {
    answerAuth('organization/list', [ACME, BIRCH])
    const activated = answerAuth('organization/set-active', BIRCH)
    const loads = answer('me/get', meAs({ organization: BIRCH, plan: 'free' }))
    const { location, queryClient } = renderAt(<OrgSwitcher />, { url: '/app/settings' })
    const menu = await open()
    await userEvent.click(await within(menu).findByRole('menuitemradio', { name: /Birch/ }))
    await waitFor(() => expect(location()).toBe('/app'))
    expect(activated).toEqual([{ input: { organizationId: BIRCH.id } }])
    expect(loads.length).toBeGreaterThan(0)
    await waitFor(() =>
      expect(queryClient.getQueryData(orpc.me.get.queryOptions().queryKey)).toMatchObject({
        organization: { name: 'Birch' },
      }),
    )
  })

  it('keeps the person loaded while the switch reloads them', async () => {
    answerAuth('organization/list', [ACME, BIRCH])
    answerAuth('organization/set-active', BIRCH)
    answer('me/get', async () => {
      await new Promise((r) => setTimeout(r, 30))
      return meAs({ organization: BIRCH, plan: 'free' })
    })
    const { queryClient } = renderAt(<OrgSwitcher />, { url: '/app/settings' })
    const { queryKey } = orpc.me.get.queryOptions()
    const missing: unknown[] = []
    queryClient.getQueryCache().subscribe(() => {
      if (queryClient.getQueryData(queryKey) === undefined) missing.push(queryKey)
    })
    const menu = await open()
    await userEvent.click(await within(menu).findByRole('menuitemradio', { name: /Birch/ }))
    await waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toMatchObject({ organization: { name: 'Birch' } }),
    )
    expect(missing).toEqual([])
  })

  it('keeps the screen and toasts when the person does not reload after a switch', async () => {
    quiet()
    answerAuth('organization/list', [ACME, BIRCH])
    answerAuth('organization/set-active', BIRCH)
    answer('me/get', 500)
    renderAt(<OrgSwitcher />, { url: '/app/settings' })
    const menu = await open()
    await userEvent.click(await within(menu).findByRole('menuitemradio', { name: /Birch/ }))
    expect(await screen.findByText("Couldn't switch organizations. Try again.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Organization: Acme' })).toBeInTheDocument()
  })

  it('toasts a failed switch', async () => {
    quiet()
    answerAuth('organization/list', [ACME, BIRCH])
    answerAuth('organization/set-active', 500)
    renderAt(<OrgSwitcher />, { url: '/app' })
    const menu = await open()
    await userEvent.click(await within(menu).findByRole('menuitemradio', { name: /Birch/ }))
    expect(await screen.findByText("Couldn't switch organizations. Try again.")).toBeInTheDocument()
  })

  it('creates an organization, which Better Auth makes active, and opens the app', async () => {
    answerAuth('organization/list', [ACME])
    const created = answerAuth('organization/create', async () => {
      await new Promise((r) => setTimeout(r, 30))
      return { ...BIRCH, name: 'Birch Labs', members: [] }
    })
    const activated = answerAuth('organization/set-active', BIRCH)
    answer('me/get', meAs({ organization: BIRCH, plan: 'free' }))
    const { location } = renderAt(<OrgSwitcher />, { url: '/app/settings' })
    const menu = await open()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Create organization' }))
    const form = await screen.findByRole('dialog', { name: 'Create an organization' })
    await userEvent.click(within(form).getByRole('button', { name: 'Create' }))
    expect(await within(form).findByText("Enter the organization's name.")).toBeInTheDocument()
    await userEvent.type(within(form).getByLabelText('Organization name'), ' Birch Labs ')
    await userEvent.dblClick(within(form).getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Birch Labs is ready.')).toBeInTheDocument()
    await waitFor(() => expect(location()).toBe('/app'))
    expect(created).toEqual([{ input: { name: 'Birch Labs', slug: 'pending' } }])
    expect(activated).toEqual([])
  })

  it('toasts a failed create and keeps the dialog open', async () => {
    quiet()
    answerAuth('organization/list', [ACME])
    answerAuth('organization/create', 500)
    renderAt(<OrgSwitcher />, { url: '/app' })
    const menu = await open()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Create organization' }))
    const form = await screen.findByRole('dialog')
    await userEvent.type(within(form).getByLabelText('Organization name'), 'Birch')
    await userEvent.click(within(form).getByRole('button', { name: 'Create' }))
    expect(
      await screen.findByText("Couldn't create the organization. Try again."),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
