import type { ListedTask, ScopedData, TaskFeedListener } from '@arrakit/db'
import { describe, expect, it, vi } from 'vitest'

import { recordingLogger } from '../observability/logger'

import { type TaskWatcher, taskWatchHub } from './watch'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function fakeData() {
  const feeds = new Map<string, TaskFeedListener>()
  const stops: string[] = []
  const get = vi.fn(async (id: string) => ({ id }) as ListedTask)
  const data = {
    forOrganization: () => ({ tasks: { get } }),
    taskFeed: {
      subscribe: vi.fn(async (organizationId: string, listener: TaskFeedListener) => {
        feeds.set(organizationId, listener)
        return () => void stops.push(organizationId)
      }),
    },
  } as unknown as ScopedData
  return { data, feeds, stops, get }
}

function watcher() {
  const rows: string[] = []
  let resyncs = 0
  let ended = false
  const watcher: TaskWatcher = {
    task: (row) => void rows.push(row.id),
    resync: () => void (resyncs += 1),
    end: () => void (ended = true),
  }
  return { watcher, rows, resyncs: () => resyncs, ended: () => ended }
}

describe('task watch hub', () => {
  it('subscribes once per organization and reads each changed task once for all its watchers', async () => {
    const { data, feeds, get } = fakeData()
    const hub = taskWatchHub(data, recordingLogger().log)
    const [a, b] = [watcher(), watcher()]
    await hub.watch('org-1', a.watcher)
    await hub.watch('org-1', b.watcher)
    expect(data.taskFeed.subscribe).toHaveBeenCalledTimes(1)

    feeds.get('org-1')!.notice({ organizationId: 'org-1', taskId: 't1' })
    await settle()
    expect(get).toHaveBeenCalledTimes(1)
    expect(a.rows).toEqual(['t1'])
    expect(b.rows).toEqual(['t1'])

    feeds.get('org-1')!.resync()
    expect([a.resyncs(), b.resyncs()]).toEqual([1, 1])
  })

  it('hands watchers the reads in the order the notices came, even when one read is slower', async () => {
    const { data, feeds, get } = fakeData()
    let finishSlow!: () => void
    get.mockImplementationOnce(
      (id: string) =>
        new Promise((resolve) => {
          finishSlow = () => resolve({ id: `${id}@first` } as ListedTask)
        }),
    )
    get.mockImplementationOnce(async (id: string) => ({ id: `${id}@second` }) as ListedTask)
    const hub = taskWatchHub(data, recordingLogger().log)
    const a = watcher()
    await hub.watch('org-1', a.watcher)

    feeds.get('org-1')!.notice({ organizationId: 'org-1', taskId: 't1' })
    feeds.get('org-1')!.notice({ organizationId: 'org-1', taskId: 't1' })
    await settle()
    expect(a.rows).toEqual([])
    finishSlow()
    await vi.waitFor(() => expect(a.rows).toEqual(['t1@first', 't1@second']))
  })

  it('stops listening to an organization once its last watcher leaves, and listens again after', async () => {
    const { data, stops } = fakeData()
    const hub = taskWatchHub(data, recordingLogger().log)
    const leaveA = await hub.watch('org-1', watcher().watcher)
    const leaveB = await hub.watch('org-1', watcher().watcher)
    leaveA()
    await settle()
    expect(stops).toEqual([])
    leaveB()
    await settle()
    expect(stops).toEqual(['org-1'])

    await hub.watch('org-1', watcher().watcher)
    expect(data.taskFeed.subscribe).toHaveBeenCalledTimes(2)
  })

  it('refuses a watcher when the feed cannot listen, and tries again for the next one', async () => {
    const { data } = fakeData()
    vi.mocked(data.taskFeed.subscribe).mockRejectedValueOnce(new Error('feed down'))
    const hub = taskWatchHub(data, recordingLogger().log)
    await expect(hub.watch('org-1', watcher().watcher)).rejects.toThrow('feed down')
    await expect(hub.watch('org-1', watcher().watcher)).resolves.toEqual(expect.any(Function))
  })

  it('ends every watcher on close', async () => {
    const { data } = fakeData()
    const hub = taskWatchHub(data, recordingLogger().log)
    const [a, b] = [watcher(), watcher()]
    await hub.watch('org-1', a.watcher)
    await hub.watch('org-2', b.watcher)
    hub.close()
    expect([a.ended(), b.ended()]).toEqual([true, true])
  })
})
