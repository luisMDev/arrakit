import { expect, test } from '@playwright/test'

import { magicLinkFor } from './mailpit'
import { payFor, rpc, signedInOwner, uniqueEmail } from './session'

const localPart = (email: string) => email.split('@')[0]!

test('an owner makes a Finance role, invites into it, and builds a team; Finance reads Billing only', async ({
  page,
  browser,
  baseURL,
}) => {
  const { organizationId } = await signedInOwner(page, { organization: 'Cedar Partners' })
  await payFor(page, organizationId, 'team_monthly')

  await page.goto('/app/settings?section=roles')
  await page.getByRole('button', { name: 'New role' }).click()
  const form = page.getByRole('dialog', { name: 'New role' })
  await form.getByRole('textbox', { name: 'Role name' }).fill('Finance')
  await form.getByRole('checkbox', { name: 'Billing: View' }).click()
  await form.getByRole('button', { name: 'Create role' }).click()
  await expect(page.getByText('Finance role created.')).toBeVisible()
  await expect(page.locator('[data-role="finance"]')).toContainText('1 permission')

  const ana = uniqueEmail('ana')
  await page.goto('/app/settings?section=members')
  await page.getByRole('textbox', { name: 'Invite someone from your organization' }).fill(ana)
  await page.getByRole('combobox', { name: 'Role' }).click()
  await page.getByRole('option', { name: 'finance' }).click()
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  await expect(page.getByText(`Invite sent to ${ana}.`)).toBeVisible()
  await expect(page.locator(`[data-invitation="${ana}"]`)).toContainText('finance')

  const anaContext = await browser.newContext({ baseURL })
  const anaPage = await anaContext.newPage()
  await anaPage.goto(await magicLinkFor(page.request, ana))
  await expect(anaPage).toHaveURL(/\/app(\/.*)?$/)
  expect(await rpc<{ role: string }>(anaPage, 'me/get')).toMatchObject({
    role: 'finance',
    permissions: { billing: ['read'] },
  })

  await anaPage.goto('/app/settings')
  const nav = anaPage.getByRole('navigation', { name: 'Settings' })
  await expect(nav.getByRole('link', { name: 'Billing' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Members' })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: 'Roles' })).toHaveCount(0)
  await nav.getByRole('link', { name: 'Billing' }).click()
  await expect(anaPage.getByRole('heading', { level: 2, name: 'Billing' })).toBeVisible()
  await expect(anaPage.getByText('Team · monthly')).toBeVisible()
  await expect(anaPage.getByRole('link', { name: 'Switch plan' })).toHaveCount(0)
  await expect(anaPage.getByRole('button', { name: 'Cancel' })).toHaveCount(0)

  await page.goto('/app/settings?section=teams')
  await page.getByRole('textbox', { name: 'Team name' }).fill('Ops')
  await page.getByRole('button', { name: 'Create team' }).click()
  await expect(page.getByText('Ops created.')).toBeVisible()
  await page.getByRole('combobox', { name: 'Add someone to Ops' }).click()
  await page.getByRole('option', { name: localPart(ana) }).click()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText(`${localPart(ana)} added to Ops.`)).toBeVisible()
  await expect(page.getByRole('list', { name: 'Members of Ops' })).toContainText(ana)

  await anaPage.goto('/app/settings?section=teams')
  await expect(anaPage.getByRole('list', { name: 'Members of Ops' })).toContainText(ana)
  await expect(anaPage.getByRole('button', { name: 'Create team' })).toHaveCount(0)

  await anaContext.close()
})
