import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { BillingSection } from '#/components/settings/billing-section'
import { leave } from '#/lib/leave'
import { answer, billingOf, meAs, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { usageFixture } from './fixtures'

setupTestApi()
vi.mock('#/lib/leave', () => ({ leave: vi.fn() }))

async function openBilling(
  usage: Parameters<typeof answer>[1] = usageFixture(),
  url = '/app/settings?section=billing',
) {
  answer('billing/get', billingOf())
  const usageCalls = answer('usage/get', usage)
  const view = renderAt(<BillingSection />, { me: meAs({ plan: 'pro' }), url })
  await screen.findByText('Plan', { selector: '[data-label]' })
  return { ...view, usageCalls }
}

const usageRegion = () => screen.getByRole('region', { name: 'Usage' })

async function openAddCredits() {
  await openBilling()
  const user = userEvent.setup()
  await user.click(within(usageRegion()).getByRole('button', { name: 'Add credits' }))
  const dialog = await screen.findByRole('dialog')
  const amount = within(dialog).getByLabelText('Amount (USD)')
  const pay = within(dialog).getByRole('button', { name: 'Continue to payment' })
  return { user, dialog, amount, pay }
}

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

describe('Settings > Billing usage', () => {
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
    expect(within(section).queryByRole('status')).not.toBeInTheDocument()
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
    await openBilling(usageFixture(), '/app/settings?section=billing&top_up=paid')
    expect(within(usageRegion()).getByRole('status')).toHaveTextContent(
      'Payment received. Your credits show up here in a moment.',
    )
  })

  it('shows no paid status without ?top_up=paid', async () => {
    await openBilling(usageFixture(), '/app/settings?section=billing&top_up=cancelled')
    await within(usageRegion()).findByText(/credits left/)
    expect(within(usageRegion()).queryByRole('status')).not.toBeInTheDocument()
  })

  it('opens Add credits, previews the amount and sends the admin to Checkout for the cents', async () => {
    const topUps = answer('billing/topUp', { url: 'https://checkout.stripe.test/c/pay/1' })
    const { user, dialog, amount, pay } = await openAddCredits()
    expect(amount).toHaveValue(20)
    expect(dialog.querySelector('[data-preview]')).toHaveTextContent(
      'You get 2,000 credits and 200 GB.',
    )
    await user.clear(amount)
    await user.type(amount, '45')
    expect(dialog.querySelector('[data-preview]')).toHaveTextContent(
      'You get 4,500 credits and 450 GB.',
    )
    await user.click(pay)
    await waitFor(() => expect(topUps).toHaveLength(1))
    expect(topUps[0]!.input).toEqual({ cents: 4_500 })
    await waitFor(() => expect(leave).toHaveBeenCalledWith('https://checkout.stripe.test/c/pay/1'))
  })

  it.each(['5', '501', ''])('refuses an amount of "%s" with the bounds in red', async (typed) => {
    const { user, dialog, amount, pay } = await openAddCredits()
    await user.clear(amount)
    if (typed) await user.type(amount, typed)
    expect(pay).toBeDisabled()
    const bounds = dialog.querySelector('[data-bounds]')
    expect(bounds).toHaveTextContent('Between $10 and $500')
    expect(bounds).toHaveClass('text-destructive')
  })

  it('says when Checkout did not open and keeps the dialog open for a retry', async () => {
    quiet()
    answer('billing/topUp', 502)
    const { user, pay } = await openAddCredits()
    await user.click(pay)
    expect(
      await screen.findByText("Couldn't open the payment. Try again in a minute."),
    ).toBeInTheDocument()
    expect(pay).toBeEnabled()
    expect(leave).not.toHaveBeenCalled()
  })

  it('closes Add credits on Cancel', async () => {
    const { user, dialog } = await openAddCredits()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('says so when usage does not load, and still shows billing', async () => {
    quiet()
    await openBilling(502)
    expect(await screen.findByText("Couldn't load usage. Reload the page.")).toBeInTheDocument()
    expect(screen.getByText('Plan', { selector: '[data-label]' })).toBeInTheDocument()
    expect(within(usageRegion()).queryByText(/credits left/)).not.toBeInTheDocument()
    expect(document.querySelector('[data-top-ups]')).not.toBeInTheDocument()
  })
})
