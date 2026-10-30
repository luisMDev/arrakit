import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { leave } from '#/lib/leave'
import { answer, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { BillingUsage, TopUpsList } from './billing-usage'
import { usageFixture } from './fixtures'

vi.mock('#/lib/leave', () => ({ leave: vi.fn() }))

setupTestApi()

const render = (ui: React.ReactElement, url = '/app/settings') => renderAt(ui, { url })

async function openDialog() {
  const user = userEvent.setup()
  render(<BillingUsage usage={usageFixture()} />)
  await user.click(await screen.findByRole('button', { name: 'Add credits' }))
  const dialog = await screen.findByRole('dialog')
  const amount = within(dialog).getByLabelText('Amount (USD)')
  const pay = within(dialog).getByRole('button', { name: 'Continue to payment' })
  return { user, dialog, amount, pay }
}

describe('Settings > Billing usage', () => {
  it('shows the cards with the plan-then-purchased split', async () => {
    render(
      <BillingUsage
        usage={usageFixture({
          plan: 'free',
          used: { credits: 150, storage_gb: 0 },
          purchased: { credits: 1_000, storage_gb: 100 },
        })}
      />,
    )
    const section = await screen.findByRole('region', { name: 'Usage' })
    expect(within(section).getByText('950 credits left')).toBeInTheDocument()
    expect(
      within(section).getByText('0 credits from your plan · 950 credits purchased'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the bar percentage for each card', async () => {
    render(
      <BillingUsage usage={usageFixture({ purchased: { credits: 2_000, storage_gb: 200 } })} />,
    )
    expect(
      await screen.findByRole('progressbar', { name: '250 credits used this month' }),
    ).toHaveAttribute('aria-valuenow', '8')
    expect(screen.getByRole('progressbar', { name: '12 GB of 300 GB used' })).toHaveAttribute(
      'aria-valuenow',
      '4',
    )
  })

  it('says a paid Checkout is on its way after ?top_up=paid', async () => {
    render(<BillingUsage usage={usageFixture()} />, '/app/settings?section=billing&top_up=paid')
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Payment received. Your credits show up here in a moment.',
    )
  })

  it('shows no paid status without ?top_up=paid', async () => {
    render(<BillingUsage usage={usageFixture()} />, '/app/settings?top_up=cancelled')
    await screen.findByRole('region', { name: 'Usage' })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('previews what an amount buys', async () => {
    const { dialog, amount, user } = await openDialog()
    expect(amount).toHaveValue(20)
    expect(dialog.querySelector('[data-preview]')).toHaveTextContent(
      'You get 2,000 credits and 200 GB.',
    )
    await user.clear(amount)
    await user.type(amount, '45')
    expect(dialog.querySelector('[data-preview]')).toHaveTextContent(
      'You get 4,500 credits and 450 GB.',
    )
  })

  it.each(['5', '501', ''])('refuses %j with the bounds in red', async (typed) => {
    const { dialog, amount, pay, user } = await openDialog()
    await user.clear(amount)
    if (typed) await user.type(amount, typed)
    expect(pay).toBeDisabled()
    const bounds = dialog.querySelector('[data-bounds]')
    expect(bounds).toHaveTextContent('Between $10 and $500')
    expect(bounds).toHaveClass('text-destructive')
  })

  it('leaves for Checkout with the amount in cents', async () => {
    const topUps = answer('billing/topUp', { url: 'https://checkout.stripe.test/c/pay/1' })
    const { pay, amount, user } = await openDialog()
    await user.clear(amount)
    await user.type(amount, '45')
    await user.click(pay)
    await waitFor(() => expect(leave).toHaveBeenCalledWith('https://checkout.stripe.test/c/pay/1'))
    expect(topUps).toEqual([{ input: { cents: 4_500 } }])
  })

  it('says when Checkout did not open and lets the admin retry', async () => {
    quiet()
    answer('billing/topUp', 502)
    const { pay, user } = await openDialog()
    await user.click(pay)
    expect(
      await screen.findByText("Couldn't open the payment. Try again in a minute."),
    ).toBeInTheDocument()
    expect(pay).toBeEnabled()
    expect(leave).not.toHaveBeenCalled()
  })

  it('closes on Cancel', async () => {
    const { dialog, user } = await openDialog()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('Top-ups list', () => {
  it('lists top-ups newest first', async () => {
    render(
      <TopUpsList
        topUps={[
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
        ]}
      />,
    )
    const rows = await screen.findAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Oct 8, 2026$25 · 2,500 credits and 250 GB')
    expect(rows[1]).toHaveTextContent('Sep 1, 2026$10 · 1,000 credits and 100 GB')
  })

  it('says when there are none', async () => {
    render(<TopUpsList topUps={[]} />)
    expect(await screen.findByText('No top-ups yet.')).toBeInTheDocument()
  })
})
