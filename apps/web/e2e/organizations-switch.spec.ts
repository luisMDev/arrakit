import { expect, test } from '@playwright/test'

import { payFor, rpc, signedInOwner } from './session'

type MeView = { organization: { name: string } | null; plan: string }

test('an owner creates a second organization, switches between them, and each shows its own plan', async ({
  page,
}) => {
  const { organizationId } = await signedInOwner(page, { organization: 'Halden Capital' })
  await payFor(page, organizationId, 'team_monthly')

  await page.goto('/app')
  const switcher = page.getByRole('button', { name: 'Workspace menu' })
  await expect(switcher).toContainText('Halden Capital')
  await expect(switcher).toContainText('Team')

  await switcher.click()
  await page.getByRole('menuitem', { name: 'Create organization' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create an organization' })
  await dialog.getByRole('textbox', { name: 'Organization name' }).fill('Birch Labs')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Birch Labs is ready.')).toBeVisible()
  await expect(switcher).toContainText('Birch Labs')
  await expect(switcher).toContainText('Free')
  expect(await rpc<MeView>(page, 'me/get')).toMatchObject({
    organization: { name: 'Birch Labs' },
    plan: 'free',
  })

  await page.goto('/app/settings?section=general')
  await expect(page.getByRole('textbox', { name: 'Organization name' })).toHaveValue('Birch Labs')

  await page.goto('/app')
  await switcher.click()
  await page.getByRole('menuitemradio', { name: /Halden Capital/ }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(switcher).toContainText('Halden Capital')
  await expect(switcher).toContainText('Team')
  expect(await rpc<MeView>(page, 'me/get')).toMatchObject({
    organization: { name: 'Halden Capital' },
    plan: 'team',
  })
  await page.goto('/app/settings?section=general')
  await expect(page.getByRole('textbox', { name: 'Organization name' })).toHaveValue(
    'Halden Capital',
  )
})
