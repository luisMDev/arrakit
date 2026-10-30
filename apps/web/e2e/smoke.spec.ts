import { expect, test } from '@playwright/test'

test('the web app renders and reaches the API through the /api proxy', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Arrakit' })).toBeVisible()

  const openapi = await request.get('/api/openapi.json')
  expect(openapi.ok()).toBe(true)

  const ping = await request.post('/api/rpc/ping', { data: {} })
  expect(ping.ok()).toBe(true)
  expect(await ping.json()).toEqual({ json: { ok: true } })
})
