import { type Page, expect, test } from '@playwright/test'

import { magicLinkFor } from './mailpit'
import { createOrganization, rpc, signIn, stripeWebhook, uniqueEmail } from './session'

const localPart = (email: string) => email.split('@')[0]!

/** An owner signed in on `page`, whose organization is on Team (through the fake Stripe webhook). */
async function ownerOnTeam(page: Page) {
  const email = uniqueEmail('owner')
  await signIn(page, email)
  const organization = await createOrganization(page, 'Halden Capital', 'Lucía Gómez')
  const slug = organization.id.slice(0, 8)
  const customerId = `cus_${slug}`
  const subscriptionId = `sub_${slug}`
  await stripeWebhook(page, {
    subscriptionId,
    organizationId: organization.id,
    subscribe: {
      id: subscriptionId,
      customerId,
      organizationId: organization.id,
      status: 'active',
      lookupKey: 'team_monthly',
    },
    bill: {
      customerId,
      snapshot: {
        subscription: {
          status: 'active',
          lookupKey: 'team_monthly',
          periodEnd: Date.UTC(2027, 9, 4) / 1000,
          cancelAtPeriodEnd: false,
          amount: { amount: 5_000, currency: 'usd' },
          scheduled: null,
        },
        customer: {
          email: email,
          name: 'Halden Capital SL',
          taxId: null,
          card: { brand: 'visa', last4: '4242' },
        },
        invoices: [
          {
            id: `in_${slug}`,
            created: Date.UTC(2026, 9, 4) / 1000,
            total: { amount: 5_000, currency: 'usd' },
            status: 'paid',
            pdfUrl: 'https://pay.stripe.test/in_1.pdf',
          },
        ],
      },
    },
  })
  await expect.poll(async () => (await rpc<{ plan: string }>(page, 'me/get')).plan).toBe('team')
  return email
}

async function invite(page: Page, email: string) {
  await page.getByRole('textbox', { name: 'Invite someone from your organization' }).fill(email)
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible()
  await expect(page.locator(`[data-invitation="${email}"]`)).toContainText('Invited today')
}

test('an owner invites colleagues who join by the emailed link; roles change, one is removed, one leaves', async ({
  page,
  browser,
  baseURL,
}) => {
  await ownerOnTeam(page)
  await page.goto('/app/members')
  await expect(page.getByRole('heading', { level: 2, name: 'Members' })).toBeVisible()
  await expect(page.locator('[data-seats]')).toHaveText('1 member')

  const kim = uniqueEmail('kim')
  const leo = uniqueEmail('leo')
  await invite(page, kim)
  await invite(page, leo)

  // Each colleague opens the invite email's link in their own browser and lands in the app.
  const kimContext = await browser.newContext({ baseURL })
  const kimPage = await kimContext.newPage()
  await kimPage.goto(await magicLinkFor(page.request, kim))
  await expect(kimPage).toHaveURL(/\/app(\/.*)?$/)
  expect(await rpc<{ role: string }>(kimPage, 'me/get')).toMatchObject({ role: 'member' })

  const leoContext = await browser.newContext({ baseURL })
  const leoPage = await leoContext.newPage()
  await leoPage.goto(await magicLinkFor(page.request, leo))
  await expect(leoPage).toHaveURL(/\/app(\/.*)?$/)

  // A member sees neither Members nor Billing, and gets Account at /app/members.
  await kimPage.goto('/app/members')
  await expect(kimPage.getByRole('heading', { level: 2, name: 'Account' })).toBeVisible()
  await expect(
    kimPage.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Members' }),
  ).toHaveCount(0)

  // The owner sees both as members, promotes Kim and removes Leo.
  await page.reload()
  await expect(page.locator('[data-seats]')).toHaveText('3 members')
  await page.getByRole('combobox', { name: `Role of ${localPart(kim)}` }).click()
  await page.getByRole('option', { name: 'Admin' }).click()
  await expect(page.getByText(`${localPart(kim)} is now an admin.`)).toBeVisible()
  expect(await rpc<{ role: string }>(kimPage, 'me/get')).toMatchObject({ role: 'admin' })

  await page.locator(`[data-member="${leo}"]`).getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText(`${localPart(leo)} removed from Halden Capital.`)).toBeVisible()
  await expect(page.locator(`[data-member="${leo}"]`)).toHaveCount(0)
  expect(await rpc<{ organization: unknown }>(leoPage, 'me/get')).toMatchObject({
    organization: null,
  })

  // Kim deletes their own account and lands on sign-in; the owner keeps the organization.
  await kimPage.goto('/app/settings')
  await kimPage.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = kimPage.getByRole('alertdialog', { name: 'Delete your account?' })
  await dialog.getByRole('button', { name: 'Delete your account' }).click()
  await expect(kimPage).toHaveURL(/\/signin$/)

  await page.reload()
  await expect(page.locator('[data-seats]')).toHaveText('1 member')
  await expect(page.locator(`[data-member="${kim}"]`)).toHaveCount(0)

  await kimContext.close()
  await leoContext.close()
})
