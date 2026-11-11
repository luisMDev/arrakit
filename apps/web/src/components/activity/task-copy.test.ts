import type { TaskView } from '@arrakit/contract'
import { describe, expect, it } from 'vitest'

import { i18n } from '#/i18n'

import { errorOf, isActive, kindOf, percentOf, statusLabel, taskTitle } from './task-copy'

const t = i18n.t.bind(i18n)
const progress = (done: number, total: number | null) => ({ progress: { done, total } })

describe('task copy', () => {
  it('reads an unknown kind as a background task, and adds the label', () => {
    expect(kindOf(t, 'nothing.like.this')).toBe('Background task')
    expect(taskTitle(t, { kind: 'nothing.like.this', label: 'Deals' })).toBe(
      'Background task · Deals',
    )
    expect(taskTitle(t, { kind: 'nothing.like.this', label: null })).toBe('Background task')
  })

  it('explains a known error and reads an unknown one as unexpected', () => {
    expect(errorOf(t, 'stalled')).toBe('The task stopped responding.')
    expect(errorOf(t, 'no_such_code')).toBe('Something went wrong.')
  })

  it('works out the percentage, rounding down, and none without a total', () => {
    expect(percentOf(progress(1, 3))).toBe(33)
    expect(percentOf(progress(5, 5))).toBe(100)
    expect(percentOf(progress(0, 0))).toBe(100)
    expect(percentOf(progress(4, null))).toBeNull()
  })

  it('says a queued task that already ran is retrying, and which attempt comes', () => {
    const task = (status: TaskView['status'], attempts: number) => ({
      status,
      attempts,
      maxAttempts: 3,
    })
    expect(statusLabel(t, task('queued', 0))).toBe('Queued')
    expect(statusLabel(t, task('queued', 1))).toBe('Retrying (2 of 3)')
    expect(statusLabel(t, task('running', 1))).toBe('Running')
    expect(isActive(task('running', 1))).toBe(true)
    expect(isActive(task('failed', 3))).toBe(false)
  })
})
