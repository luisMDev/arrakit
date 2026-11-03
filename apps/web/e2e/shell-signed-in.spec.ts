import { expect, test } from '@playwright/test'

import { signIn, signedInOwner, uniqueEmail } from './session'

test('a signed-in owner moves around the app from the sidebar', async ({ page }) => {
  await signedInOwner(page, { who: 'ana', personName: 'Ana Ruiz' })

  await page.goto('/app')
  await expect(page.getByRole('heading', { level: 1, name: 'Hi, Ana Ruiz.' })).toBeVisible()
  await expect(page.getByText('Acme is on Free.', { exact: false })).toBeVisible()
  await expect(page).toHaveTitle('Arrakit · Home')
  await expect(page.locator('header')).toHaveCount(1)
  await expect(page.locator('header').getByRole('link', { name: 'Home' })).toHaveAttribute(
    'href',
    '/app',
  )

  const menuButton = page.getByRole('button', { name: 'Account menu' })
  await expect(menuButton).toHaveText('A')
  const viewTransitionName = (selector: string) =>
    page.locator(selector).evaluate((element) => getComputedStyle(element).viewTransitionName)
  expect(await viewTransitionName('header')).toBe('site-header')
  expect(await viewTransitionName('nav[aria-label="Account"]')).toBe('app-bar')
  expect(await viewTransitionName('[data-slot="sidebar-container"]')).toBe('app-sidebar')

  const sidebar = page.getByRole('navigation', { name: 'Navigation' })
  await expect(sidebar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

  for (const [item, path, section] of [
    ['Settings', '/app/settings', 'Account'],
    ['Members', '/app/settings\\?section=members', 'Members'],
    ['Billing', '/app/settings\\?section=billing', 'Billing'],
  ] as const) {
    await sidebar.getByRole('link', { name: item }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: item })).toHaveAttribute('aria-current', 'page')
  }

  const toggle = page.getByRole('button', { name: 'Show or hide navigation' })
  await toggle.click()
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed')
  await toggle.click()
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'expanded')

  await page.goto('/app/booking')
  await expect(page).toHaveURL(/\/app\/booking$/)
  await expect(page.getByRole('heading', { name: 'This page does not exist.' })).toBeVisible()

  await menuButton.click()
  await page.locator('#app-menu').getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/signin$/)
  await page.goto('/app')
  await expect(page).toHaveURL(/\/signin$/)
})

test('a free organization opening Welcome without a checkout goes to Plans', async ({ page }) => {
  await signedInOwner(page, { who: 'free', organization: 'Free Co', personName: 'Fran' })
  await page.goto('/app/welcome')
  await expect(page).toHaveURL(/\/app\/plans$/)
})

test('a person with no organization is sent to create one', async ({ page }) => {
  await signIn(page, uniqueEmail('new'))
  await page.goto('/app')
  await expect(page).toHaveURL(/\/profile/)
})

test('the unavailable screen never sends Try again off the app', async ({ page }) => {
  await page.goto('/unavailable?next=https%3A%2F%2Fevil.example%2Fapp')
  await expect(page.getByRole('heading', { name: "Couldn't reach Arrakit." })).toBeVisible()
  await expect(page).toHaveTitle('Arrakit · Unavailable')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page).toHaveURL(/\/signin$/)
})

test('on a phone the sidebar opens as a sheet and closes on the way to a destination', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signedInOwner(page)
  await page.goto('/app')
  await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeHidden()

  await page.getByRole('button', { name: 'Show or hide navigation' }).click()
  await page.getByRole('dialog').getByRole('link', { name: 'Workspaces' }).click()
  await expect(page).toHaveURL(/\/app\/workspaces$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
