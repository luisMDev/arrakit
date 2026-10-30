import { expect, test } from '@playwright/test'

import { WEB_ORIGIN } from './origins'

test('the web app renders and reaches the API through the /api proxy', async ({
  page,
  request,
}) => {
  // "/" has no page of its own: it redirects to /signin (a visitor stays there).
  await page.goto('/')
  await expect(page).toHaveURL(/\/signin$/)
  await expect(page.getByRole('heading', { name: 'Where should we write to you?' })).toBeVisible()
  await expect(page).toHaveTitle('Arrakit · Sign in')

  const providers = await request.post('/api/rpc/authProviders/get', {
    data: {},
    headers: { origin: WEB_ORIGIN },
  })
  expect(providers.ok()).toBe(true)
  expect(await providers.json()).toEqual({ json: { google: false, microsoft: false } })
})

test('a visitor opening the app is sent to sign in', async ({ page }) => {
  await page.goto('/app/settings')
  await expect(page).toHaveURL(/\/signin$/)
})
