import type { RealtimeAccess } from '@arrakit/contract'
import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { answer, setupTestApi } from '#/test/rpc'

type Status = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR'

const sdk = vi.hoisted(() => {
  interface FakeChannel {
    topic: string
    options: unknown
    bindings: { type: string; filter: unknown; callback: (message: unknown) => void }[]
    status?: (status: string) => void
  }
  interface FakeClient {
    url: string
    key: string
    options: { accessToken: () => Promise<string | null> }
    channels: FakeChannel[]
    removed: FakeChannel[]
  }
  const state = { clients: [] as FakeClient[], calls: [] as string[] }
  const createClient = (url: string, key: string, options: FakeClient['options']) => {
    const fake: FakeClient = { url, key, options, channels: [], removed: [] }
    state.clients.push(fake)
    return {
      realtime: {
        setAuth: async () => {
          state.calls.push('setAuth')
        },
      },
      channel(topic: string, channelOptions: unknown) {
        const channel: FakeChannel = { topic, options: channelOptions, bindings: [] }
        fake.channels.push(channel)
        const api = {
          on(type: string, filter: unknown, callback: (message: unknown) => void) {
            channel.bindings.push({ type, filter, callback })
            return api
          },
          subscribe(status: (status: string) => void) {
            state.calls.push('subscribe')
            channel.status = status
            return api
          },
          channel,
        }
        return api
      },
      removeChannel: async (api: { channel: FakeChannel }) => {
        fake.removed.push(api.channel)
        return 'ok'
      },
    }
  }
  return { state, createClient }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: sdk.createClient }))

setupTestApi()

const MINUTE = 60_000

function accessOf(overrides: Partial<RealtimeAccess> = {}): RealtimeAccess {
  return {
    url: 'http://127.0.0.1:54321',
    publishableKey: 'sb_publishable_test',
    token: 'token-1',
    expiresAt: new Date(Date.now() + 10 * MINUTE).toISOString(),
    topics: { tasks: 'org:acme:tasks' },
    ...overrides,
  }
}

let joinChannel: typeof import('./realtime').joinChannel

beforeEach(async () => {
  sdk.state.clients.length = 0
  sdk.state.calls.length = 0
  vi.resetModules()
  ;({ joinChannel } = await import('./realtime'))
})

const handlers = () => ({ subscribed: vi.fn(), message: vi.fn(), down: vi.fn() })

async function joined(event = 'task.changed') {
  const heard = handlers()
  const channel = joinChannel((topics) => topics.tasks, event, heard)
  await waitFor(() => expect(sdk.state.clients[0]?.channels).toHaveLength(1))
  const client = sdk.state.clients[0]!
  const fake = client.channels[0]!
  return {
    heard,
    channel,
    client,
    fake,
    report: (status: Status) => fake.status!(status),
    broadcast: (payload: unknown) =>
      fake.bindings[0]!.callback({ type: 'broadcast', event, payload }),
  }
}

describe('joinChannel', () => {
  it('asks the API for access and joins the picked topic as a private channel, authorised first', async () => {
    const access = answer('realtime/access', accessOf())
    const { client, fake } = await joined('task.changed')

    expect(access).toHaveLength(1)
    expect(client.url).toBe('http://127.0.0.1:54321')
    expect(client.key).toBe('sb_publishable_test')
    expect(client.options.accessToken).toBeTypeOf('function')
    expect(fake.topic).toBe('org:acme:tasks')
    expect(fake.options).toEqual({ config: { private: true } })
    expect(fake.bindings).toEqual([
      { type: 'broadcast', filter: { event: 'task.changed' }, callback: expect.any(Function) },
    ])
    await waitFor(() => expect(sdk.state.calls).toEqual(['setAuth', 'subscribe']))
  })

  it('reports the join and each broadcast payload', async () => {
    answer('realtime/access', accessOf())
    const { heard, report, broadcast } = await joined()
    await waitFor(() => expect(sdk.state.calls).toContain('subscribe'))

    report('SUBSCRIBED')
    expect(heard.subscribed).toHaveBeenCalledOnce()
    broadcast({ taskId: 'one' })
    expect(heard.message).toHaveBeenCalledWith({ taskId: 'one' })
    expect(heard.down).not.toHaveBeenCalled()
  })

  it.each<Status>(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])(
    'removes the channel and reports down once on %s',
    async (status) => {
      answer('realtime/access', accessOf())
      const { heard, report, broadcast, client, fake } = await joined()
      await waitFor(() => expect(sdk.state.calls).toContain('subscribe'))

      report(status)
      report('CLOSED')
      report('SUBSCRIBED')
      broadcast({ taskId: 'late' })
      expect(heard.down).toHaveBeenCalledOnce()
      expect(heard.subscribed).not.toHaveBeenCalled()
      expect(heard.message).not.toHaveBeenCalled()
      await waitFor(() => expect(client.removed).toEqual([fake]))
    },
  )

  it('reports down when the API offers no Realtime', async () => {
    answer('realtime/access', null)
    const heard = handlers()
    joinChannel((topics) => topics.tasks, 'task.changed', heard)
    await waitFor(() => expect(heard.down).toHaveBeenCalledOnce())
    expect(sdk.state.clients).toHaveLength(0)
  })

  it('reports down when the API cannot be asked', async () => {
    answer('realtime/access', 500)
    const heard = handlers()
    joinChannel((topics) => topics.tasks, 'task.changed', heard)
    await waitFor(() => expect(heard.down).toHaveBeenCalledOnce())
    expect(sdk.state.clients).toHaveLength(0)
  })

  it('removes the channel on close and reports nothing after it', async () => {
    answer('realtime/access', accessOf())
    const { heard, channel, report, broadcast, client, fake } = await joined()
    await waitFor(() => expect(sdk.state.calls).toContain('subscribe'))

    channel.close()
    report('SUBSCRIBED')
    report('CHANNEL_ERROR')
    broadcast({ taskId: 'late' })
    await waitFor(() => expect(client.removed).toEqual([fake]))
    expect(heard.subscribed).not.toHaveBeenCalled()
    expect(heard.down).not.toHaveBeenCalled()
    expect(heard.message).not.toHaveBeenCalled()
  })

  it('never joins when closed before the API answers', async () => {
    let release!: () => void
    const answered = new Promise<void>((resolve) => {
      release = resolve
    })
    const access = answer('realtime/access', async () => {
      await answered
      return accessOf()
    })
    const heard = handlers()
    const channel = joinChannel((topics) => topics.tasks, 'task.changed', heard)
    await waitFor(() => expect(access).toHaveLength(1))

    channel.close()
    release()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(sdk.state.calls).not.toContain('subscribe')
    expect(heard.down).not.toHaveBeenCalled()
  })
})

describe('the token Realtime reads', () => {
  it('is the held one while more than a minute of it remains', async () => {
    const access = answer('realtime/access', accessOf({ token: 'long' }))
    const { client } = await joined()

    expect(await client.options.accessToken()).toBe('long')
    expect(access).toHaveLength(1)
  })

  it('is asked for again when less than a minute remains, once for calls at the same time', async () => {
    const soon = new Date(Date.now() + 30_000).toISOString()
    const access = answer(
      'realtime/access',
      accessOf({ token: 'short', expiresAt: soon }),
      accessOf({ token: 'fresh' }),
    )
    const { client } = await joined()

    const tokens = await Promise.all([client.options.accessToken(), client.options.accessToken()])
    expect(tokens).toEqual(['fresh', 'fresh'])
    expect(access).toHaveLength(2)
    expect(await client.options.accessToken()).toBe('fresh')
    expect(access).toHaveLength(2)
  })

  it('stays the held one when asking again fails', async () => {
    const soon = new Date(Date.now() + 30_000).toISOString()
    const access = answer('realtime/access', accessOf({ token: 'short', expiresAt: soon }), 503)
    const { client } = await joined()

    expect(await client.options.accessToken()).toBe('short')
    expect(access).toHaveLength(2)
  })
})
