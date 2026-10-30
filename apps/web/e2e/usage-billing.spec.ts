import { expect, test } from '@playwright/test'

import { magicLinkFor } from './mailpit'
import { payFor, rpc, signedInOwner, stripeWebhook, uniqueEmail } from './session'

test('an admin adds credits from Billing: preview, Checkout, then the webhook credits the top-up', async ({
  page,
}) => {
  const { organizationId } = await signedInOwner(page, { organization: 'Usage Co' })
  await page.route('https://checkout.stripe.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Fake Checkout</h1>' }),
  )

  await page.goto('/app/billing')
  const usage = page.getByRole('region', { name: 'Usage' })
  await expect(usage.locator('[data-metric="credits"] [data-available]')).toHaveText(
    '100 credits left',
  )
  await expect(page.locator('[data-top-ups]')).toContainText('No top-ups yet.')

  await usage.getByRole('button', { name: 'Add credits' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('[data-preview]')).toHaveText('You get 2,000 credits and 200 GB.')
  const amount = dialog.getByLabel('Amount (USD)')
  await amount.fill('5')
  await expect(dialog.getByRole('button', { name: 'Continue to payment' })).toBeDisabled()
  await amount.fill('45')
  await expect(dialog.locator('[data-preview]')).toHaveText('You get 4,500 credits and 450 GB.')
  await dialog.getByRole('button', { name: 'Continue to payment' }).click()
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.test\/c\/pay\/cs_test_top_up_\d+$/)

  await stripeWebhook(page, {
    kind: 'top-up',
    sessionId: `cs_test_top_up_${organizationId.slice(0, 8)}`,
    organizationId,
    customerId: null,
    cents: 4_500,
    paid: true,
  })

  await page.goto('/app/billing?top_up=paid')
  await expect(usage.getByRole('status')).toHaveText(
    'Payment received. Your credits show up here in a moment.',
  )
  await expect(usage.locator('[data-metric="credits"] [data-available]')).toHaveText(
    '4,600 credits left',
  )
  const rows = page.locator('[data-top-ups]').getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('$45 · 4,500 credits and 450 GB')
})

test('a member sees the usage cards in Settings > Usage, with no Add credits', async ({
  page,
  browser,
  baseURL,
}) => {
  const { organizationId } = await signedInOwner(page, { organization: 'Usage Co' })
  await payFor(page, organizationId, 'team_monthly')

  const memberEmail = uniqueEmail('member')
  await rpc(page, 'invitations/invite', { email: memberEmail, role: 'member' })
  const memberContext = await browser.newContext({ baseURL })
  const memberPage = await memberContext.newPage()
  await memberPage.goto(await magicLinkFor(page.request, memberEmail))
  await expect(memberPage).toHaveURL(/\/app(\/.*)?$/)
  expect(await rpc<{ role: string }>(memberPage, 'me/get')).toMatchObject({ role: 'member' })

  await memberPage.goto('/app/settings')
  await memberPage.getByRole('link', { name: 'Usage' }).click()
  const section = memberPage.getByRole('region', { name: 'Usage' })
  await expect(section.locator('[data-metric="credits"] [data-available]')).toContainText(
    'credits left',
  )
  await expect(section.locator('[data-hint]')).toHaveText(
    'Running low? An owner or an admin can add credits.',
  )
  await expect(section.getByRole('button')).toHaveCount(0)
  await expect(memberPage.getByRole('button', { name: 'Add credits' })).toHaveCount(0)

  await memberContext.close()
})
