import { type Page, expect, test } from '@playwright/test'

import { magicLinkFor } from './mailpit'
import { WEB_ORIGIN } from './origins'

async function signInWithOrganization(page: Page) {
  const email = `vt-${Date.now()}@acme.test`
  const sent = await page.request.post('/api/auth/sign-in/magic-link', {
    data: { email, callbackURL: '/app' },
    headers: { origin: WEB_ORIGIN },
  })
  expect(sent.ok(), await sent.text()).toBe(true)
  await page.goto(await magicLinkFor(page.request, email))
  const created = await page.request.post('/api/rpc/organizations/create', {
    data: { json: { name: 'Acme', personName: 'Ana Ruiz', termsAccepted: true } },
    headers: { origin: WEB_ORIGIN },
  })
  expect(created.ok(), await created.text()).toBe(true)
}

const viewTransitionName = (page: Page, selector: string) =>
  page.locator(selector).evaluate((element) => getComputedStyle(element).viewTransitionName)

test('the header and the app bar stay out of the page fade', async ({ page }) => {
  await signInWithOrganization(page)
  await page.goto('/app')
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
  expect(await viewTransitionName(page, 'header')).toBe('site-header')
  expect(await viewTransitionName(page, 'nav[aria-label="Account"]')).toBe('app-bar')
})

test('a navigation runs inside a view transition', async ({ page }) => {
  await page.addInitScript(() => {
    const original = document.startViewTransition?.bind(document)
    if (!original) return
    const counted = window as Window & { viewTransitions?: number }
    counted.viewTransitions = 0
    document.startViewTransition = ((update: ViewTransitionUpdateCallback) => {
      counted.viewTransitions! += 1
      return original(update)
    }) as typeof document.startViewTransition
  })
  await signInWithOrganization(page)
  await page.goto('/app')
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.locator('#app-menu').getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/app\/settings$/)
  const count = await page.evaluate(
    () => (window as Window & { viewTransitions?: number }).viewTransitions ?? 0,
  )
  expect(count).toBeGreaterThan(0)
})
