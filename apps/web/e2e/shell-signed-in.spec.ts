import { expect, test } from '@playwright/test'

import { signIn, signedInOwner, uniqueEmail } from './session'

test('a signed-in owner moves around the app from the sidebar', async ({ page }) => {
  await signedInOwner(page, { who: 'ana', personName: 'Ana Ruiz' })

  await page.goto('/app')
  await expect(page.getByRole('heading', { level: 1, name: 'Hi, Ana Ruiz.' })).toBeVisible()
  await expect(page.getByText('Acme is on Free.', { exact: false })).toBeVisible()
  await expect(page).toHaveTitle('Arrakit · Home')
  await expect(page.locator('header')).toHaveCount(0)
  const sidebarHead = page.locator('[data-sidebar="header"]')
  await expect(sidebarHead.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/app')

  const menuButton = page.getByRole('button', { name: 'Workspace menu' })
  await expect(menuButton).toContainText('Acme')
  await expect(menuButton).toContainText('Free')
  const viewTransitionName = (selector: string) =>
    page.locator(selector).evaluate((element) => getComputedStyle(element).viewTransitionName)
  expect(await viewTransitionName('[data-slot="sidebar-container"]')).toBe('app-sidebar')

  const sidebar = page.getByRole('navigation', { name: 'Navigation' })
  await expect(sidebar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

  await menuButton.click()
  await expect(page.getByRole('menu')).toContainText('Free · 1 member')
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/app\/settings$/)
  await expect(sidebar).toHaveCount(0)
  await expect(menuButton).toHaveCount(0)
  const person = page.getByRole('group', { name: 'Signed in as' })
  await expect(person).toContainText('Ana Ruiz')
  const settings = page.getByRole('navigation', { name: 'Settings' })
  await expect(settings.getByRole('link', { name: 'Account' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  for (const [section, path] of [
    ['Members', '/app/settings\\?section=members'],
    ['Billing', '/app/settings\\?section=billing'],
  ] as const) {
    await settings.getByRole('link', { name: section }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible()
    await expect(settings.getByRole('link', { name: section })).toHaveAttribute(
      'aria-current',
      'page',
    )
  }
  await settings.getByRole('link', { name: 'Back' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(sidebar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

  const toggle = page.getByRole('button', { name: 'Show or hide navigation' })
  await toggle.click()
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed')
  await toggle.click()
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'expanded')

  await page.goto('/app/booking')
  await expect(page).toHaveURL(/\/app\/booking$/)
  await expect(page.getByRole('heading', { name: 'This page does not exist.' })).toBeVisible()

  await menuButton.click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
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
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Workspace menu' }).click()
  await page.getByRole('menuitem', { name: 'All workspaces' }).click()
  await expect(page).toHaveURL(/\/app\/workspaces$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible()
  await expect(sheet).toHaveCount(0)
})
