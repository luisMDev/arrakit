import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { notify } from './notify'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('notify', () => {
  afterEach(() => vi.clearAllMocks())

  it.each([
    ['success', 4000],
    ['error', 6000],
  ] as const)('shows a %s toast for %i ms', (level, duration) => {
    notify[level]('Saved')
    expect(toast[level]).toHaveBeenCalledWith('Saved', { id: `${level}:Saved`, duration })
  })

  it('gives the same text the same id so it never stacks', () => {
    notify.error('Not saved')
    notify.error('Not saved')
    const ids = vi.mocked(toast.error).mock.calls.map(([, options]) => options?.id)
    expect(ids).toEqual(['error:Not saved', 'error:Not saved'])
  })

  it('tells levels and descriptions apart in the id', () => {
    notify.success('Done')
    notify.error('Email not sent', { description: 'For ana@acme.com' })
    notify.error('Email not sent', { description: 'For kim@acme.com' })
    expect(vi.mocked(toast.success).mock.calls[0]?.[1]?.id).toBe('success:Done')
    expect(vi.mocked(toast.error).mock.calls.map(([, options]) => options?.id)).toEqual([
      'error:Email not sent:For ana@acme.com',
      'error:Email not sent:For kim@acme.com',
    ])
  })

  it('passes the description and action through', () => {
    const onClick = vi.fn()
    notify.error('Email not sent', {
      description: 'Resend it',
      action: { label: 'Resend', onClick },
    })
    expect(toast.error).toHaveBeenCalledWith(
      'Email not sent',
      expect.objectContaining({ description: 'Resend it', action: { label: 'Resend', onClick } }),
    )
  })
})
