import { ORPCError } from '@orpc/client'
import { renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFailureToast } from './use-failure-toast'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const refused = new ORPCError('FORBIDDEN', { status: 403, message: 'Only admins can see billing.' })

describe('useFailureToast', () => {
  let report: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.clearAllMocks())

  it('does nothing without an error', () => {
    renderHook(() => useFailureToast(null, '[test] load failed', 'Not loaded'))
    expect(toast.error).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it("reports the error and toasts the API's own message", () => {
    renderHook(() => useFailureToast(refused, '[test] load failed', 'Not loaded'))
    expect(report).toHaveBeenCalledWith('[test] load failed', refused)
    expect(toast.error).toHaveBeenCalledWith('Only admins can see billing.', expect.anything())
  })

  it("toasts the screen's text when the API has no message", () => {
    const down = new ORPCError('INTERNAL_SERVER_ERROR', { status: 500 })
    renderHook(() => useFailureToast(down, '[test] load failed', 'Not loaded'))
    expect(toast.error).toHaveBeenCalledWith('Not loaded', expect.anything())
  })

  it('toasts once per error across renders', () => {
    const { rerender } = renderHook(
      ({ error }) => useFailureToast(error, '[test] load failed', 'Not loaded'),
      { initialProps: { error: refused as unknown } },
    )
    rerender({ error: refused })
    rerender({ error: refused })
    expect(toast.error).toHaveBeenCalledTimes(1)

    const again = new ORPCError('INTERNAL_SERVER_ERROR', { status: 500 })
    rerender({ error: again })
    expect(toast.error).toHaveBeenCalledTimes(2)
  })

  it('stays quiet once the error clears', () => {
    const { rerender } = renderHook(
      ({ error }) => useFailureToast(error, '[test] load failed', 'Not loaded'),
      { initialProps: { error: refused as unknown } },
    )
    rerender({ error: null })
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})
