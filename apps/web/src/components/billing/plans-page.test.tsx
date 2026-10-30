import type { Me } from '@arrakit/contract'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { PlansPage } from './plans-page'
import { OFFERS, answer, api, billingOf, meOn, renderAt } from './testing'

beforeAll(() => api.listen({ onUnhandledFrame: 'bypass' }))
afterEach(() => {
  api.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => api.close())

const card = (name: string) => screen.getByRole('article', { name })
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined)

async function setup(me: Me) {
  answer('plans/list', OFFERS)
  answer('me/get', me)
  const view = renderAt(<PlansPage />, { me, url: '/app/plans' })
  await screen.findByRole('article', { name: 'Team' })
  return view
}

const PREVIEW_NOW = {
  applies: 'now',
  on: '2026-10-30',
  dueToday: { amount: 120_000, currency: 'usd' },
  nextInvoice: { amount: 48_000, currency: 'usd' },
}

describe('PlansPage', () => {
  it('marks Team recommended and the organization’s own plan as current', async () => {
    await setup(meOn('free'))
    expect(within(card('Team')).getByText('Recommended')).toBeInTheDocument()
    expect(within(card('Free')).getByRole('button', { name: 'Your current plan' })).toBeDisabled()
    expect(within(card('Pro')).getByRole('button', { name: 'Select Pro' })).toBeEnabled()
    expect(within(card('Team')).getByRole('button', { name: 'Select Team' })).toBeEnabled()
  })

  it('offers a paying top plan the switch down, and marks its paying cycle', async () => {
    answer('billing/get', billingOf({ plan: 'team', cycle: 'monthly' }))
    await setup(meOn('team'))
    const cycle = screen.getByRole('group', { name: 'Billing' })
    await waitFor(() =>
      expect(within(cycle).getByRole('button', { name: 'Monthly' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(within(card('Team')).getByRole('button', { name: 'Your current plan' })).toBeDisabled()
    expect(within(card('Pro')).getByRole('button', { name: 'Switch to Pro' })).toBeEnabled()
    await userEvent.click(within(cycle).getByRole('button', { name: /Yearly/ }))
    expect(within(card('Team')).getByRole('button', { name: 'Switch to Team' })).toBeEnabled()
  })

  it('switches up with today’s charge, then lands on Billing', async () => {
    answer('billing/get', billingOf({ plan: 'pro', cycle: 'yearly' }))
    const previews = answer('billing/previewChange', PREVIEW_NOW)
    const changes = answer('billing/change', billingOf({ plan: 'team' }))
    const view = await setup(meOn('pro'))
    const switchTo = await within(card('Team')).findByRole('button', { name: 'Switch to Team' })
    await userEvent.click(switchTo)
    const dialog = await screen.findByRole('dialog', { name: 'Switch to Team, yearly' })
    expect(previews[0]?.input).toEqual({ plan: 'team', cycle: 'yearly' })
    expect(
      within(dialog).getByText('$1,200 today, for the rest of this period.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Then $480 a year.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch to Team' }))
    await waitFor(() => expect(view.location().pathname).toBe('/app/billing'))
    expect(changes[0]?.input).toEqual({ plan: 'team', cycle: 'yearly' })
  })

  it('switches down at the renewal, nothing to pay today', async () => {
    answer('billing/get', billingOf({ plan: 'team', cycle: 'yearly' }))
    answer('billing/previewChange', {
      applies: 'renewal',
      on: '2027-10-04',
      dueToday: { amount: 0, currency: 'usd' },
      nextInvoice: { amount: 19_200, currency: 'usd' },
    })
    await setup(meOn('team'))
    await userEvent.click(await within(card('Pro')).findByRole('button', { name: 'Switch to Pro' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Nothing to pay today.')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Your organization keeps Team until Oct 4, 2027, then moves to Pro: $192 a year.',
      ),
    ).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('says so when the switch cannot be priced', async () => {
    quiet()
    answer('billing/get', billingOf({ plan: 'pro', cycle: 'yearly' }))
    answer('billing/previewChange', 502)
    await setup(meOn('pro'))
    await userEvent.click(
      await within(card('Team')).findByRole('button', { name: 'Switch to Team' }),
    )
    expect(
      await screen.findByText("Couldn't price the switch. Try again in a minute."),
    ).toBeInTheDocument()
  })

  it('shows the API refusal when the switch fails', async () => {
    quiet()
    answer('billing/get', billingOf({ plan: 'pro', cycle: 'yearly' }))
    answer('billing/previewChange', PREVIEW_NOW)
    answer('billing/change', [
      402,
      'Your card was declined. Update it under Payment, then try again.',
    ])
    await setup(meOn('pro'))
    await userEvent.click(
      await within(card('Team')).findByRole('button', { name: 'Switch to Team' }),
    )
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch to Team' }))
    expect(
      await screen.findByText('Your card was declined. Update it under Payment, then try again.'),
    ).toBeInTheDocument()
  })

  it('never sends a paying organization to Checkout when its billing fails to load', async () => {
    quiet()
    answer('billing/get', 502)
    await setup(meOn('pro'))
    expect(
      await screen.findByText("Couldn't load your billing. Reload the page."),
    ).toBeInTheDocument()
    expect(within(card('Team')).queryByRole('button')).not.toBeInTheDocument()
    expect(within(card('Free')).queryByRole('button')).not.toBeInTheDocument()
  })

  it('sends a yearly Select straight to Checkout', async () => {
    const view = await setup(meOn('free'))
    await userEvent.click(within(card('Team')).getByRole('button', { name: 'Select Team' }))
    await waitFor(() => expect(view.location().pathname).toBe('/app/checkout'))
    expect(view.location().search).toEqual({ plan: 'team', cycle: 'yearly' })
  })

  it('offers yearly billing before a monthly Checkout, and closes back to Plans', async () => {
    const view = await setup(meOn('free'))
    await userEvent.click(screen.getByRole('button', { name: 'Monthly' }))
    await userEvent.click(within(card('Team')).getByRole('button', { name: 'Select Team' }))
    const dialog = await screen.findByRole('dialog', { name: 'Pay less with yearly billing' })
    expect(dialog).toHaveTextContent('Team, yearly')
    expect(dialog).toHaveTextContent('Save 20%')
    expect(dialog).toHaveTextContent('$480 a year instead of $600.')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(view.location().pathname).toBe('/app/plans')
  })

  it.each([
    ['Continue yearly', 'yearly'],
    ['Continue monthly', 'monthly'],
  ])('goes to Checkout from the yearly offer with %s', async (button, cycle) => {
    const view = await setup(meOn('free'))
    await userEvent.click(screen.getByRole('button', { name: 'Monthly' }))
    await userEvent.click(within(card('Pro')).getByRole('button', { name: 'Select Pro' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: button }))
    await waitFor(() => expect(view.location().pathname).toBe('/app/checkout'))
    expect(view.location().search).toEqual({ plan: 'pro', cycle })
  })

  it('shows a member no buy buttons, only who can change the plan', async () => {
    await setup(meOn('free', 'member'))
    expect(within(card('Pro')).queryByRole('button')).not.toBeInTheDocument()
    expect(within(card('Team')).queryByRole('button')).not.toBeInTheDocument()
    expect(
      screen.getByText('Only an admin of your organization can change its plan.'),
    ).toBeInTheDocument()
  })

  it('links to the app and to every plan', async () => {
    await setup(meOn('free'))
    expect(screen.getByRole('link', { name: 'Not now' })).toHaveAttribute('href', '/app')
    expect(screen.getByRole('link', { name: 'Compare all plans' })).toHaveAttribute(
      'href',
      '/pricing',
    )
  })

  it('says so when the plans cannot load', async () => {
    answer('plans/list', 500)
    renderAt(<PlansPage />, { me: meOn('free'), url: '/app/plans' })
    expect(await screen.findByText("Couldn't load the plans. Reload the page.")).toBeInTheDocument()
  })
})
