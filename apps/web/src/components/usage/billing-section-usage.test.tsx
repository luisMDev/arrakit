import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { billingOf, meOn } from '#/components/billing/testing'
import { BillingSection } from '#/components/settings/billing-section'
import { answer, api, quiet, renderAt } from '#/test/rpc'

import { usageFixture } from './fixtures'

beforeAll(() => api.listen({ onUnhandledFrame: 'bypass' }))
afterEach(() => {
  api.resetHandlers()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})
afterAll(() => api.close())

async function openBilling(
  usage: Parameters<typeof answer>[1] = usageFixture(),
  redirect: (url: string) => void = () => undefined,
) {
  answer('billing/get', billingOf())
  const usageCalls = answer('usage/get', usage)
  const view = renderAt(<BillingSection redirect={redirect} />, {
    me: meOn('pro'),
    url: '/app/billing',
  })
  await screen.findByText('Plan', { selector: 'dt' })
  return { ...view, usageCalls }
}

const usageRegion = () => screen.getByRole('region', { name: 'Usage' })

/** The lines of the `metric` card, each by its data attribute. */
function card(section: HTMLElement, metric: string) {
  const el = section.querySelector(`[data-metric="${metric}"]`) as HTMLElement
  const line = (name: string) => el.querySelector(`[data-${name}]`)?.textContent?.trim()
  return {
    available: line('available'),
    split: line('split'),
    used: line('used'),
    resets: line('resets'),
  }
}

describe('Settings > Billing usage (through the Billing page)', () => {
  it('feeds usage.get into the cards with the plan-then-purchased split and bar percentages', async () => {
    await openBilling(
      usageFixture({
        plan: 'free',
        used: { credits: 150, storage_gb: 12 },
        purchased: { credits: 1_000, storage_gb: 100 },
      }),
    )
    const section = usageRegion()
    expect(await within(section).findByText('950 credits left')).toBeInTheDocument()
    expect(
      within(section).getByText('0 credits from your plan · 950 credits purchased'),
    ).toBeInTheDocument()
    expect(
      within(section).getByRole('progressbar', { name: '150 credits used this month' }),
    ).toHaveAttribute('aria-valuenow', '14')
    expect(within(section).getByRole('button', { name: 'Add credits' })).toBeInTheDocument()
  })

  it('shows a $20 top-up on Pro in the cards', async () => {
    await openBilling(usageFixture({ purchased: { credits: 2_000, storage_gb: 200 } }))
    const section = usageRegion()
    expect(await within(section).findByText('2,750 credits left')).toBeInTheDocument()
    expect(within(section).getByText('288 GB free')).toBeInTheDocument()
    expect(
      within(section).getByRole('progressbar', { name: '250 credits used this month' }),
    ).toHaveAttribute('aria-valuenow', '8')
    expect(
      within(section).getByRole('progressbar', { name: '12 GB of 300 GB used' }),
    ).toHaveAttribute('aria-valuenow', '4')
    expect(card(section, 'credits')).toEqual({
      available: '2,750 credits left',
      split: '750 credits from your plan · 2,000 credits purchased',
      used: '250 credits used this month',
      resets: "Your plan's part resets on Nov 4, 2026",
    })
    expect(card(section, 'storage_gb')).toEqual({
      available: '288 GB free',
      split: '100 GB from your plan · 200 GB purchased',
      used: '12 GB of 300 GB used',
      resets: "Your plan's part resets on Nov 4, 2026",
    })
  })

  it('lists the top-ups from usage.get newest first', async () => {
    await openBilling(
      usageFixture({
        topUps: [
          {
            paidOn: '2026-10-08',
            cents: 2_500,
            amounts: [
              { metric: 'credits', amount: 2_500 },
              { metric: 'storage_gb', amount: 250 },
            ],
          },
          {
            paidOn: '2026-09-01',
            cents: 1_000,
            amounts: [
              { metric: 'credits', amount: 1_000 },
              { metric: 'storage_gb', amount: 100 },
            ],
          },
        ],
      }),
    )
    await screen.findByText('Top-ups')
    const topUps = document.querySelector('[data-top-ups]') as HTMLElement
    const rows = within(topUps).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Oct 8, 2026$25 · 2,500 credits and 250 GB')
    expect(rows[1]).toHaveTextContent('Sep 1, 2026$10 · 1,000 credits and 100 GB')
  })

  it('says when there are no top-ups yet', async () => {
    await openBilling()
    await waitFor(() =>
      expect(document.querySelector('[data-top-ups]')).toHaveTextContent('No top-ups yet.'),
    )
  })

  it('says a paid Checkout is on its way after ?top_up=paid', async () => {
    window.history.pushState({}, '', '/app/billing?top_up=paid')
    await openBilling()
    expect(within(usageRegion()).getByRole('status')).toHaveTextContent(
      'Payment received. Your credits show up here in a moment.',
    )
  })

  it('opens Add credits, previews the amount and sends the admin to Checkout for the cents', async () => {
    const topUps = answer('billing/topUp', { url: 'https://checkout.stripe.test/c/pay/1' })
    const redirect = vi.fn()
    await openBilling(usageFixture(), redirect)
    const user = userEvent.setup()
    await user.click(within(usageRegion()).getByRole('button', { name: 'Add credits' }))
    const dialog = await screen.findByRole('dialog')
    const amount = within(dialog).getByLabelText('Amount (USD)')
    expect(dialog.querySelector('[data-preview]')).toHaveTextContent(
      'You get 2,000 credits and 200 GB.',
    )
    await user.clear(amount)
    await user.type(amount, '45')
    expect(dialog.querySelector('[data-preview]')).toHaveTextContent(
      'You get 4,500 credits and 450 GB.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Continue to payment' }))
    await waitFor(() => expect(topUps).toHaveLength(1))
    expect(topUps[0]!.input).toEqual({ cents: 4_500 })
    await waitFor(() =>
      expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.test/c/pay/1'),
    )
  })

  it.each(['5', '501', ''])('refuses an amount of "%s" outside the bounds', async (typed) => {
    await openBilling()
    const user = userEvent.setup()
    await user.click(within(usageRegion()).getByRole('button', { name: 'Add credits' }))
    const dialog = await screen.findByRole('dialog')
    const amount = within(dialog).getByLabelText('Amount (USD)')
    await user.clear(amount)
    if (typed) await user.type(amount, typed)
    expect(within(dialog).getByRole('button', { name: 'Continue to payment' })).toBeDisabled()
    expect(dialog.querySelector('[data-bounds]')).toHaveTextContent('Between $10 and $500')
  })

  it('says when Checkout did not open and keeps the dialog open', async () => {
    quiet()
    answer('billing/topUp', 502)
    await openBilling()
    const user = userEvent.setup()
    await user.click(within(usageRegion()).getByRole('button', { name: 'Add credits' }))
    const dialog = await screen.findByRole('dialog')
    const pay = within(dialog).getByRole('button', { name: 'Continue to payment' })
    await user.click(pay)
    expect(
      await screen.findByText("Couldn't open the payment. Try again in a minute."),
    ).toBeInTheDocument()
    expect(pay).toBeEnabled()
  })

  it('says so when usage does not load, and still shows billing', async () => {
    quiet()
    await openBilling(502)
    expect(await screen.findByText("Couldn't load usage. Reload the page.")).toBeInTheDocument()
    expect(screen.getByText('Plan', { selector: 'dt' })).toBeInTheDocument()
    expect(within(usageRegion()).queryByText(/credits left/)).not.toBeInTheDocument()
    expect(document.querySelector('[data-top-ups]')).not.toBeInTheDocument()
  })
})
