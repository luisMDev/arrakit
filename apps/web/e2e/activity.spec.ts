import { expect, test } from '@playwright/test'

import { signedInOwner } from './session'

test('reaches Activity from the sidebar and shows nothing running or finished yet', async ({
  page,
}) => {
  await signedInOwner(page, { organization: 'Rowan Partners' })
  await page.goto('/app')
  await page.getByRole('link', { name: 'Activity' }).click()

  await expect(page).toHaveURL(/\/app\/activity$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible()
  await expect(page.getByText('Nothing is running right now.')).toBeVisible()
  await page.getByRole('tab', { name: 'Finished' }).click()
  await expect(page).toHaveURL(/\/app\/activity\?tab=finished$/)
  await expect(page.getByText('Nothing has finished yet.')).toBeVisible()
})

test('streams task changes through the web origin as they happen, not when the stream ends', async ({
  page,
}) => {
  await signedInOwner(page, { organization: 'Aspen Partners' })
  await page.goto('/app/activity')

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
