import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { orpc } from '#/lib/orpc'
import { answer, answerAuth, meAs, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { SidebarProvider } from '#/components/ui/sidebar'

import { AccountMenu } from './account-menu'

setupTestApi()

const ACME = meAs().organization!
const BIRCH = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Birch',
  slug: 'birch',
  plan: 'free' as const,
}

const renderMenu = (url: string) =>
  renderAt(
    <SidebarProvider>
      <AccountMenu />
    </SidebarProvider>,
    { url },
  )

const trigger = () => screen.findByRole('button', { name: 'Account menu' })

const open = async () => {
  await userEvent.click(await trigger())
  return screen.findByRole('menu')
}

describe('AccountMenu', () => {
  it('shows the person, the organization and its plan, and lists every organization with the current one checked', async () => {
    answerAuth('organization/list', [ACME, BIRCH])
    renderMenu('/app')
    const button = await trigger()
    expect(button).toHaveTextContent('L')
    expect(button).toHaveTextContent('Lucía Gómez')
    expect(button).toHaveTextContent('Acme · Team')
    const opened = await open()
    expect(opened).toHaveTextContent('lucia@acme.com')
    expect(await within(opened).findByRole('menuitemradio', { name: /Birch/ })).toHaveTextContent(
      'BirchFree',
    )
    expect(within(opened).getByRole('menuitemradio', { name: /Acme/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(
      within(opened).getByRole('menuitem', { name: 'Create organization' }),
    ).toBeInTheDocument()
  })

  it('switches organization, reloads the screens and opens the app', async () => {
    answerAuth('organization/list', [ACME, BIRCH])
    const activated = answerAuth('organization/set-active', BIRCH)
    const loads = answer('me/get', meAs({ organization: BIRCH, plan: 'free' }))
    const { location, queryClient } = renderMenu('/app/settings')
    const opened = await open()
    await userEvent.click(await within(opened).findByRole('menuitemradio', { name: /Birch/ }))
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
    const { queryClient } = renderMenu('/app/settings')
    const { queryKey } = orpc.me.get.queryOptions()
    const missing: unknown[] = []
    queryClient.getQueryCache().subscribe(() => {
      if (queryClient.getQueryData(queryKey) === undefined) missing.push(queryKey)
    })
    const opened = await open()
    await userEvent.click(await within(opened).findByRole('menuitemradio', { name: /Birch/ }))
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
    renderMenu('/app/settings')
    const opened = await open()
    await userEvent.click(await within(opened).findByRole('menuitemradio', { name: /Birch/ }))
    expect(await screen.findByText("Couldn't switch organizations. Try again.")).toBeInTheDocument()
    expect(await trigger()).toHaveTextContent('Acme · Team')
  })

  it('toasts a failed switch', async () => {
    quiet()
    answerAuth('organization/list', [ACME, BIRCH])
    answerAuth('organization/set-active', 500)
    renderMenu('/app')
    const opened = await open()
    await userEvent.click(await within(opened).findByRole('menuitemradio', { name: /Birch/ }))
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
    const { location } = renderMenu('/app/settings')
    const opened = await open()
    await userEvent.click(within(opened).getByRole('menuitem', { name: 'Create organization' }))
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
    renderMenu('/app')
    const opened = await open()
    await userEvent.click(within(opened).getByRole('menuitem', { name: 'Create organization' }))
    const form = await screen.findByRole('dialog')
    await userEvent.type(within(form).getByLabelText('Organization name'), 'Birch')
    await userEvent.click(within(form).getByRole('button', { name: 'Create' }))
    expect(
      await screen.findByText("Couldn't create the organization. Try again."),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
