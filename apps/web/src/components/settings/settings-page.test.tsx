import type { Me } from '@arrakit/contract'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { SettingsPage, type SettingsSection } from './settings-page'
import { answer, api, meAs, renderScreen } from './testing'

beforeAll(() => api.listen({ onUnhandledFrame: 'bypass' }))
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
  answer('members/list', [])
  answer('invitations/list', [])
})
afterEach(() => api.resetHandlers())
afterAll(() => api.close())

const renderAs = (role: Me['role'], section: SettingsSection = 'account') =>
  renderScreen(<SettingsPage section={section} />, { me: meAs({ role }) })

const nav = () => screen.getByRole('navigation', { name: 'Settings' })

describe('SettingsPage', () => {
  it('groups the sections and marks the current one', async () => {
    renderAs('owner')
    await screen.findByRole('heading', { level: 2, name: 'Account' })
    const mine = within(nav()).getByRole('group', { name: 'My settings' })
    expect(
      within(mine)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Account'])
    const organization = within(nav()).getByRole('group', { name: 'Organization settings' })
    expect(
      within(organization)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['General', 'Usage', 'Members', 'Billing', 'Security and data'])
    expect(within(nav()).getByRole('button', { name: 'Account' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('switches sections in page', async () => {
    renderAs('admin', 'members')
    expect(await screen.findByRole('heading', { level: 2, name: 'Members' })).toBeInTheDocument()
    await userEvent.click(within(nav()).getByRole('button', { name: 'General' }))
    expect(screen.getByRole('heading', { level: 2, name: 'General' })).toBeInTheDocument()
    expect(within(nav()).getByRole('button', { name: 'General' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it.each<SettingsSection>(['members', 'billing'])(
    'hides Members and Billing from a member, who gets Account at /app/%s',
    async (section) => {
      renderAs('member', section)
      expect(await screen.findByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument()
      expect(within(nav()).queryByRole('button', { name: 'Members' })).toBeNull()
      expect(within(nav()).queryByRole('button', { name: 'Billing' })).toBeNull()
    },
  )

  it('goes back to the app', async () => {
    const { location } = renderAs('owner')
    await userEvent.click(await screen.findByRole('link', { name: 'Back' }))
    await waitFor(() => expect(location()).toBe('/app'))
  })
})
