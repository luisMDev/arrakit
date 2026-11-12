import { expect, test } from '@playwright/test'

import { magicLinkFor } from './mailpit'
import { inviteMember, payFor, rpc, signedInOwner, uniqueEmail } from './session'

test('an owner creates, edits and deletes workspaces; a member sees them and adds one', async ({
  page,
  browser,
  baseURL,
}) => {
  const { organizationId } = await signedInOwner(page, { organization: 'Larch Partners' })
  await payFor(page, organizationId, 'team_monthly')

  await page.goto('/app')
  const workspaceMenu = page.getByRole('button', { name: 'Workspace menu' })
  await expect(workspaceMenu).toContainText('Larch Partners')
  await workspaceMenu.click()
  await page.getByRole('menuitem', { name: 'All workspaces' }).click()
  await expect(page).toHaveURL(/\/app\/workspaces$/)
  await expect(page.getByRole('main').getByText('No workspaces yet.')).toBeVisible()

  await page.getByRole('button', { name: 'New workspace' }).click()
  const create = page.getByRole('dialog', { name: 'New workspace' })
  await create.getByRole('textbox', { name: 'Name' }).fill('Deals')
  await create.getByRole('textbox', { name: 'Description' }).fill('Pipeline and closings')
  await create.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByText('Deals created.')).toBeVisible()
  await expect(page.locator('[data-workspace="Deals"]')).toContainText('Pipeline and closings')

  await page.getByRole('button', { name: 'New workspace' }).click()
  await create.getByRole('textbox', { name: 'Name' }).fill('DEALS')
  await create.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByText('A workspace named DEALS already exists.')).toBeVisible()
  await create.getByRole('button', { name: 'Cancel' }).click()

  await page.goto('/app')
  await expect(page).toHaveURL(/\/app\/workspaces\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Deals' })).toBeVisible()
  await expect(workspaceMenu).toContainText('Deals')
  await expect(workspaceMenu).toContainText('Larch Partners')
  await workspaceMenu.click()
  await expect(page.getByRole('menuitemradio', { name: 'Deals' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('menuitem', { name: 'All workspaces' }).click()
  await expect(page).toHaveURL(/\/app\/workspaces$/)

  const memberEmail = uniqueEmail('member')
  await inviteMember(page, organizationId, memberEmail)
  const memberContext = await browser.newContext({ baseURL })
  const memberPage = await memberContext.newPage()
  try {
    await memberPage.goto(await magicLinkFor(page.request, memberEmail))
    await expect(memberPage).toHaveURL(/\/app(\/.*)?$/)
    expect(await rpc<{ role: string }>(memberPage, 'me/get')).toMatchObject({ role: 'member' })

    await memberPage.goto('/app/workspaces')
    const deals = memberPage.locator('[data-workspace="Deals"]')
    await expect(deals).toBeVisible()
    await expect(deals.getByRole('button')).toHaveCount(0)
    await memberPage.getByRole('button', { name: 'New workspace' }).click()
    const memberCreate = memberPage.getByRole('dialog', { name: 'New workspace' })
    await memberCreate.getByRole('textbox', { name: 'Name' }).fill('Research')
    await memberCreate.getByRole('button', { name: 'Create workspace' }).click()
    await expect(memberPage.getByText('Research created.')).toBeVisible()
  } finally {
    await memberContext.close()
  }

  await page.reload()
  await expect(page.locator('[data-workspace]')).toHaveCount(2)
  await page.getByRole('button', { name: 'Edit Deals' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit workspace' })
  await edit.getByRole('textbox', { name: 'Name' }).fill('Deal flow')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Deal flow saved.')).toBeVisible()

  await page.getByRole('button', { name: 'Delete Research' }).click()
  await page
    .getByRole('alertdialog', { name: 'Delete Research?' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(page.getByText('Research deleted.')).toBeVisible()
  await expect(page.locator('[data-workspace]')).toHaveCount(1)
  await expect(page.locator('[data-workspace="Deal flow"]')).toBeVisible()
})
