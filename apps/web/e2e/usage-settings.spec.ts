import { type Page, expect, test } from '@playwright/test'

import { magicLinkFor } from './mailpit'
import { WEB_ORIGIN } from './origins'

async function signInWithOrganization(page: Page, email: string) {
  const sent = await page.request.post('/api/auth/sign-in/magic-link', {
    data: { email, callbackURL: '/app' },
    headers: { origin: WEB_ORIGIN },
  })
  expect(sent.ok(), await sent.text()).toBe(true)
  await page.goto(await magicLinkFor(page.request, email))

  const created = await page.request.post('/api/rpc/organizations/create', {
    data: { json: { name: 'Usage Co', termsAccepted: true } },
    headers: { origin: WEB_ORIGIN },
  })
  expect(created.ok(), await created.text()).toBe(true)
}

test('an owner sees what is left this month in Settings > Usage', async ({ page }) => {
  await signInWithOrganization(page, `owner-${Date.now()}@usage.test`)
  await page.goto('/app/settings')
  await page.getByRole('button', { name: 'Usage' }).click()

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
