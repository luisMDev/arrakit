import { ORPCError } from '@orpc/client'
import { render as renderUi, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { withQueries } from '#/test/rpc'

import { BillingUsage, TopUpsList } from './billing-usage'
import { usageFixture } from './fixtures'

const render = (ui: React.ReactElement) => renderUi(ui, { wrapper: withQueries() })

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', async (original) => {
  const sonner = await original<typeof import('sonner')>()
  return { ...sonner, toast: Object.assign(vi.fn(), sonner.toast, { error: toastError }) }
})

async function openDialog(props: Partial<React.ComponentProps<typeof BillingUsage>> = {}) {
  const user = userEvent.setup()
  render(<BillingUsage usage={usageFixture()} topUpPaid={false} {...props} />)
  await user.click(screen.getByRole('button', { name: 'Add credits' }))
  const dialog = await screen.findByRole('dialog')
  const amount = within(dialog).getByLabelText('Amount (USD)')
  const pay = within(dialog).getByRole('button', { name: 'Continue to payment' })
  return { user, dialog, amount, pay }
}

describe('Settings > Billing usage', () => {
  afterEach(() => toastError.mockReset())

  it('shows the cards with the plan-then-purchased split', () => {
    render(
      <BillingUsage
        usage={usageFixture({
          plan: 'free',
          used: { credits: 150, storage_gb: 0 },
          purchased: { credits: 1_000, storage_gb: 100 },
        })}
        topUpPaid={false}
      />,
    )
    const section = screen.getByRole('region', { name: 'Usage' })
    expect(within(section).getByText('950 credits left')).toBeInTheDocument()
    expect(
      within(section).getByText('0 credits from your plan · 950 credits purchased'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the bar percentage for each card', () => {
    render(
      <BillingUsage
        usage={usageFixture({ purchased: { credits: 2_000, storage_gb: 200 } })}
        topUpPaid={false}
      />,
    )
    expect(
      screen.getByRole('progressbar', { name: '250 credits used this month' }),
    ).toHaveAttribute('aria-valuenow', '8')
    expect(screen.getByRole('progressbar', { name: '12 GB of 300 GB used' })).toHaveAttribute(
      'aria-valuenow',
      '4',
    )
  })

  it('says a paid Checkout is on its way', () => {
    render(<BillingUsage usage={usageFixture()} topUpPaid />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Payment received. Your credits show up here in a moment.',
    )
  })

  it('reads ?top_up=paid from the URL after mount when not told', async () => {
    window.history.pushState({}, '', '/app/billing?top_up=paid')
    try {
      render(<BillingUsage usage={usageFixture()} />)
      expect(await screen.findByRole('status')).toHaveTextContent('Payment received.')
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('shows no paid status without ?top_up=paid', () => {
    window.history.pushState({}, '', '/app/billing?top_up=cancelled')
    try {
      render(<BillingUsage usage={usageFixture()} />)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    } finally {
      window.history.pushState({}, '', '/')
    }
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
    const startTopUp = vi.fn(async () => ({ url: 'https://checkout.stripe.test/c/pay/1' }))
    const redirect = vi.fn()
    const { pay, amount, user } = await openDialog({ startTopUp, redirect })
    await user.clear(amount)
    await user.type(amount, '45')
    await user.click(pay)
    await waitFor(() =>
      expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.test/c/pay/1'),
    )
    expect(startTopUp).toHaveBeenCalledWith(4_500)
  })

  it('says when Checkout did not open and lets the admin retry', async () => {
    const startTopUp = vi.fn(async () => {
      throw new ORPCError('BAD_GATEWAY', { status: 502 })
    })
    const redirect = vi.fn()
    const { pay, user } = await openDialog({ startTopUp, redirect })
    await user.click(pay)
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Couldn't open the payment. Try again in a minute.",
        expect.anything(),
      ),
    )
    expect(pay).toBeEnabled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('closes on Cancel', async () => {
    const { dialog, user } = await openDialog()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('Top-ups list', () => {
  it('lists top-ups newest first', () => {
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
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Oct 8, 2026$25 · 2,500 credits and 250 GB')
    expect(rows[1]).toHaveTextContent('Sep 1, 2026$10 · 1,000 credits and 100 GB')
  })

  it('says when there are none', () => {
    render(<TopUpsList topUps={[]} />)
    expect(document.querySelector('[data-top-ups]')).toHaveTextContent('No top-ups yet.')
  })
})
