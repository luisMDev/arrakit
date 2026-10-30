import { expect, test } from '@playwright/test'

import { magicLinkFor } from './mailpit'
import { WEB_ORIGIN } from './origins'
import { inviteMember, payFor, signedInOwner, uniqueEmail } from './session'

test('a visitor picks Pro on Pricing, signs up, creates the organization and reaches Checkout', async ({
  page,
}) => {
  await page.goto('/pricing')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pricing for')
  await page.getByRole('link', { name: 'Get Pro' }).click()
  await expect(page).toHaveURL(/\/signup\?plan=pro&cycle=yearly$/)

  const email = uniqueEmail('visitor')
  await page.getByRole('textbox', { name: 'Work email' }).fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.goto(await magicLinkFor(page.request, email))
  await expect(page).toHaveURL(/\/profile\?plan=pro&cycle=yearly$/)
  await page.getByRole('button', { name: 'Skip' }).click()

  await expect(page).toHaveURL(/\/app\/checkout\?plan=pro&cycle=yearly$/)
  const summary = page.getByRole('region', { name: 'Order summary' })
  await expect(summary.getByText('Subscribe to Arrakit Pro')).toBeVisible()
  await expect(summary.getByText('per year')).toBeVisible()
})

test('an admin on Free selects Team monthly and is offered yearly before Checkout', async ({
  page,
}) => {
  await signedInOwner(page, { who: 'free', organization: 'Billing Co' })
  await page.goto('/app/plans')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pick the plan')
  await page
    .getByRole('group', { name: 'Billing' })
    .getByRole('button', { name: 'Monthly' })
    .click()
  await page.getByRole('button', { name: 'Select Team' }).click()
  const dialog = page.getByRole('dialog', { name: 'Pay less with yearly billing' })
  await expect(dialog).toContainText('$480 a year instead of $600.')
  await dialog.getByRole('button', { name: 'Continue monthly' }).click()
  await expect(page).toHaveURL(/\/app\/checkout\?plan=team&cycle=monthly$/)
  await expect(page.getByRole('region', { name: 'Order summary' })).toContainText('per month')
})

test('a paid webhook welcomes the organization to Team, and Billing shows it', async ({ page }) => {
  const { organizationId } = await signedInOwner(page, {
    who: 'welcome',
    organization: 'Billing Co',
  })
  await payFor(page, organizationId, 'team_yearly')
  await page.goto('/app/welcome?session_id=cs_test_1')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Team')

  await page.goto('/app/billing')
  const billing = page.getByRole('region', { name: 'Billing' })
  await expect(billing.getByText('Team · yearly')).toBeVisible()
  await expect(billing.getByText('Oct 4, 2027')).toBeVisible()
  await expect(billing.getByText('Visa ending 4242')).toBeVisible()
  await expect(billing.getByRole('link', { name: 'Download' })).toBeVisible()
})

test('a paying admin switches up to Team, then cancels and keeps the plan', async ({ page }) => {
  const { organizationId } = await signedInOwner(page, {
    who: 'switch',
    organization: 'Billing Co',
  })
  await payFor(page, organizationId, 'pro_yearly')

  await page.goto('/app/plans')
  await page.getByRole('button', { name: 'Switch to Team' }).click()
  const dialog = page.getByRole('dialog', { name: 'Switch to Team, yearly' })
  await expect(dialog).toContainText('$1,200 today, for the rest of this period.')
  await dialog.getByRole('button', { name: 'Switch to Team' }).click()
  await expect(page).toHaveURL(/\/app\/settings\?section=billing$/)
  const billing = page.getByRole('region', { name: 'Billing' })
  await expect(billing.getByText('Team · yearly')).toBeVisible()

  await billing.getByRole('button', { name: 'Cancel', exact: true }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Cancel your plan?' })
  await confirm.getByRole('button', { name: 'Cancel plan' }).click()
  await expect(billing.getByText('Ends on')).toBeVisible()
  await billing.getByRole('button', { name: 'Keep my plan' }).click()
  await expect(billing.getByText('Renews on')).toBeVisible()
})

test('Checkout without a valid plan goes back to Plans', async ({ page }) => {
  await signedInOwner(page, { who: 'invalid', organization: 'Billing Co' })
  await page.goto('/app/checkout?plan=enterprise&cycle=yearly')
  await expect(page).toHaveURL(/\/app\/plans$/)
})

test('a member sees Plans without buy buttons and cannot reach Billing or Checkout', async ({
  page,
  browser,
}) => {
  const { organizationId } = await signedInOwner(page, { who: 'owner', organization: 'Billing Co' })
  await payFor(page, organizationId, 'pro_yearly')
  const memberEmail = uniqueEmail('member')
  await inviteMember(page, organizationId, memberEmail)

  const context = await browser.newContext({ baseURL: WEB_ORIGIN })
  const member = await context.newPage()
  try {
    await member.goto(await magicLinkFor(member.request, memberEmail))
    await expect(member).toHaveURL(/\/app$/)

    await member.goto('/app/plans')
    await expect(
      member.getByText('Only an admin of your organization can change its plan.'),
    ).toBeVisible()
    await expect(member.getByRole('button', { name: /^(Select|Switch to) / })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Your current plan' })).toBeVisible()

    await member.goto('/app/checkout?plan=team&cycle=yearly')
    await expect(member).toHaveURL(/\/app\/plans$/)

    await member.goto('/app/billing')
    await expect(member.getByRole('heading', { name: 'Account' })).toBeVisible()
    await expect(member.getByRole('region', { name: 'Billing' })).toHaveCount(0)
  } finally {
    await context.close()
  }
})
