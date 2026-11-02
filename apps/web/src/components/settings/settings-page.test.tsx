import type { Me } from '@arrakit/contract'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { answer, answerAuth, meAs, renderAt, setupTestApi } from '#/test/rpc'

import { type SettingsSection, SettingsPage, settingsSearch } from './settings-page'

setupTestApi()
beforeEach(() => {
  answer('me/account/get', {
    name: 'Lucía Gómez',
    email: 'lucia@acme.com',
    signInWith: 'email',
    devices: ['Mac'],
    language: 'en',
    timeZone: 'Europe/Madrid',
    emails: { productNews: false },
  })
  answerAuth('organization/list-members', { members: [], total: 0 })
  answerAuth('organization/list-invitations', [])
  answerAuth('organization/list-roles', [])
  answerAuth('organization/list-teams', [])
})

const renderAs = (
  role: Me['role'],
  section: SettingsSection = 'account',
  permissions?: Me['permissions'],
) =>
  renderAt((search) => <SettingsPage section={settingsSearch.parse(search).section} />, {
    me: meAs({ role, ...(permissions ? { permissions } : {}) }),
    url: `/app/settings?section=${section}`,
  })

const organizationLinks = () =>
  within(within(nav()).getByRole('group', { name: 'Organization settings' }))
    .getAllByRole('link')
    .map((b) => b.textContent)

const nav = () => screen.getByRole('navigation', { name: 'Settings' })

describe('SettingsPage', () => {
  it('groups the sections and marks the current one', async () => {
    renderAs('owner')
    await screen.findByRole('heading', { level: 2, name: 'Account' })
    const mine = within(nav()).getByRole('group', { name: 'My settings' })
    expect(
      within(mine)
        .getAllByRole('link')
        .map((b) => b.textContent),
    ).toEqual(['Account'])
    expect(organizationLinks()).toEqual([
      'General',
      'Usage',
      'Members',
      'Teams',
      'Roles',
      'Billing',
      'Security and data',
    ])
    expect(within(nav()).getByRole('link', { name: 'Account' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('switches sections through the URL', async () => {
    const { router } = renderAs('admin', 'members')
    expect(await screen.findByRole('heading', { level: 2, name: 'Members' })).toBeInTheDocument()
    await userEvent.click(within(nav()).getByRole('link', { name: 'General' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'General' })).toBeInTheDocument()
    expect(router.state.location.search).toEqual({ section: 'general' })
    expect(within(nav()).getByRole('link', { name: 'General' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it.each<SettingsSection>(['members', 'billing'])(
    'hides Members and Billing from a member, who gets Account for section %s',
    async (section) => {
      renderAs('member', section)
      expect(await screen.findByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument()
      expect(within(nav()).queryByRole('link', { name: 'Members' })).toBeNull()
      expect(within(nav()).queryByRole('link', { name: 'Billing' })).toBeNull()
    },
  )

  it('shows a member what their role reads: no Members, Roles or Billing', async () => {
    renderAs('member')
    await screen.findByRole('heading', { level: 2, name: 'Account' })
    expect(organizationLinks()).toEqual(['General', 'Usage', 'Teams', 'Security and data'])
  })

  it('shows a custom role the sections its permissions open', async () => {
    renderAs('finance', 'account', { billing: ['read'] })
    await screen.findByRole('heading', { level: 2, name: 'Account' })
    expect(organizationLinks()).toEqual(['General', 'Teams', 'Billing', 'Security and data'])
  })

  it('opens Teams and Roles', async () => {
    renderAs('owner', 'teams')
    expect(await screen.findByRole('heading', { level: 2, name: 'Teams' })).toBeInTheDocument()
    await userEvent.click(within(nav()).getByRole('link', { name: 'Roles' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Roles' })).toBeInTheDocument()
  })

  it('goes back to the app', async () => {
    const { location } = renderAs('owner')
    await userEvent.click(await screen.findByRole('link', { name: 'Back' }))
    await waitFor(() => expect(location()).toBe('/app'))
  })
})
