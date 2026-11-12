import { randomUUID } from 'node:crypto'

import type { RealtimeAccess } from '@arrakit/contract'
import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

import { WEB_ORIGIN } from './origins'
import { rpc, signedInOwner } from './session'
import { drivingTasks } from './task-driver'

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

test('shows background work as it happens', async ({ page }) => {
  const { organizationId } = await signedInOwner(page, { organization: 'Aspen Partners' })
  const joined = page.waitForEvent('websocket', (socket) =>
    socket.url().includes('/realtime/v1/websocket'),
  )
  await page.goto('/app/settings?section=tasks')
  await joined
  await expect(page.getByText('Nothing is running right now.')).toBeVisible()
  const session = await page.request.get('/api/auth/get-session')
  const { user } = (await session.json()) as { user: { id: string } }

  await drivingTasks(organizationId, async (tasks) => {
    const task = await tasks.start({
      queue: 'e2e-tasks',
      kind: 'e2e.unknown',
      workspaceId: null,
      label: 'Deals',
      requestedBy: user.id,
      maxAttempts: 1,
      input: {},
    })
    const row = page.locator(`[data-task="${task.id}"]`)
    await expect(row.getByText('Queued')).toBeVisible()

    await tasks.begin(task.id, 0)
    await tasks.progress(task.id, 1, 2)
    await expect(
      row.getByRole('progressbar', { name: 'Background task · Deals: 50% done' }),
    ).toBeVisible()

    await tasks.succeed(task.id)
    await expect(page.getByText('Background task · Deals is done.')).toBeVisible()
    await expect(row).toHaveCount(0)
    await page.getByRole('tab', { name: 'Finished' }).click()
    await expect(row).toBeVisible()
  })
})

test('joins only the task channel of its own organization', async ({ page, browser }) => {
  const { organizationId } = await signedInOwner(page, { organization: 'Birch Partners' })
  const other = await browser.newContext({ baseURL: WEB_ORIGIN })
  const otherPage = await other.newPage()
  const { organizationId: otherOrganizationId } = await signedInOwner(otherPage, {
    organization: 'Cedar Partners',
  })
  await other.close()

  const access = await rpc<RealtimeAccess | null>(page, 'realtime/access')
  expect(access).not.toBeNull()
  const supabase = createClient(access!.url, access!.publishableKey, {
    accessToken: async () => access!.token,
  })
  await supabase.realtime.setAuth()
  const joining = async (topic: string) => {
    const channel = supabase.channel(topic, { config: { private: true } })
    const status = await new Promise<string>((resolve) =>
      channel.subscribe((state) => resolve(`${state}`)),
    )
    if (status !== 'SUBSCRIBED') await supabase.removeChannel(channel)
    return status
  }

  try {
    expect(access!.topics.tasks).toBe(`org:${organizationId}:tasks`)
    expect(await joining(access!.topics.tasks)).toBe('SUBSCRIBED')
    expect(await joining(`org:${otherOrganizationId}:tasks`)).toBe('CHANNEL_ERROR')
    expect(await joining(`org:${organizationId}:user:${randomUUID()}:tasks`)).toBe('CHANNEL_ERROR')
  } finally {
    await supabase.removeAllChannels()
  }
})
