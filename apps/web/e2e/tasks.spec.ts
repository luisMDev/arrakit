import { expect, test } from '@playwright/test'

import { rpc, signedInOwner } from './session'

test('finds all the background work in Settings, and each workspace keeps its own', async ({
  page,
}) => {
  await signedInOwner(page, { organization: 'Rowan Partners' })
  await page.goto('/app/settings')
  await page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('link', { name: 'Tasks' })
    .click()

  await expect(page).toHaveURL(/\/app\/settings\?section=tasks$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible()
  await expect(page.getByText(/every workspace and the organization itself/)).toBeVisible()
  await expect(page.getByText('Nothing is running right now.')).toBeVisible()
  await page.getByRole('tab', { name: 'Finished' }).click()
  await expect(page.getByText('Nothing has finished yet.')).toBeVisible()

  const workspace = await rpc<{ id: string }>(page, 'workspaces/create', {
    name: 'Deals',
    description: '',
  })
  await page.goto(`/app/workspaces/${workspace.id}`)
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Tasks' })
    .click()
  await expect(page).toHaveURL(new RegExp(`/app/workspaces/${workspace.id}/tasks$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible()
  await expect(page.getByText('Background work in Deals, and how far along it is.')).toBeVisible()
  await expect(page.getByText('Nothing is running right now.')).toBeVisible()
})

test('streams task changes through the web origin as they happen, not when the stream ends', async ({
  page,
}) => {
  await signedInOwner(page, { organization: 'Aspen Partners' })
  await page.goto('/app/settings?section=tasks')

  const first = await page.evaluate(async () => {
    const started = performance.now()
    const controller = new AbortController()
    const res = await fetch('/api/rpc/tasks/watch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: {} }),
      signal: controller.signal,
    })
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    while (!text.includes('"resync"')) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value)
    }
    controller.abort()
    return {
      status: res.status,
      type: res.headers.get('content-type'),
      text,
      ms: performance.now() - started,
    }
  })

  expect(first.status).toBe(200)
  expect(first.type).toContain('text/event-stream')
  expect(first.text).toContain('{"json":{"type":"resync"}}')
  expect(first.ms).toBeLessThan(5_000)
})
