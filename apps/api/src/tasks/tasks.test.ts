import type { OrganizationScope } from '@arrakit/db'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { taskService } from './tasks'
import type { TaskWatchHub } from './watch'

describe('task service watch', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('leaves no timer or listener behind when the organization cannot be watched', async () => {
    vi.useFakeTimers()
    const watches = {
      watch: vi.fn(async () => {
        throw new Error('feed down')
      }),
      close: vi.fn(),
    } as unknown as TaskWatchHub
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const service = taskService({
      userId: 'user-1',
      permissions: { task: ['read'], workspace: ['read'] },
      scope: {} as OrganizationScope,
      organizationId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    })

    await expect(service.watch({}, watches, controller.signal).next()).rejects.toThrow('feed down')
    expect(vi.getTimerCount()).toBe(0)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
