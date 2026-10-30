import { expect, test } from '@playwright/test'

import { signedInOwner } from './session'

test('an owner sees what is left this month in Settings > Usage', async ({ page }) => {
  await signedInOwner(page, { organization: 'Usage Co' })
  await page.goto('/app/settings')
  await page.getByRole('link', { name: 'Usage' }).click()

  const section = page.getByRole('region', { name: 'Usage' })
  await expect(section.locator('[data-metric="credits"] [data-available]')).toHaveText(
    '100 credits left',
  )
  await expect(section.locator('[data-metric="storage_gb"] [data-used]')).toHaveText(
    '0 GB of 10 GB used',
  )
  await expect(section.locator('[data-hint]')).toHaveText('Add credits in Billing.')
  await expect(section.getByRole('button')).toHaveCount(0)
})
