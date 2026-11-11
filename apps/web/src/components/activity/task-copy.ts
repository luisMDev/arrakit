import type { TaskView } from '@arrakit/contract'
import type { TFunction } from 'i18next'

export const isActive = (task: Pick<TaskView, 'status'>) =>
  task.status === 'queued' || task.status === 'running'

/** What the task does, from its kind; a kind without copy reads as a background task. */
export const kindOf = (t: TFunction, kind: string): string =>
  t(`activity.kinds.${kind}`, { defaultValue: t('activity.kinds.unknown') })

/** "Export workspace · Deals": the kind, then the task's own label when it has one. */
export const taskTitle = (t: TFunction, task: Pick<TaskView, 'kind' | 'label'>): string =>
  task.label ? `${kindOf(t, task.kind)} · ${task.label}` : kindOf(t, task.kind)

/** Why it failed; a code without copy reads as unexpected. */
export const errorOf = (t: TFunction, code: string): string =>
  t(`activity.errors.${code}`, { defaultValue: t('activity.errors.unexpected') })

/** 0-100, or null while how much work there is is not known. */
export function percentOf({ progress }: Pick<TaskView, 'progress'>): number | null {
  if (progress.total === null) return null
  if (progress.total === 0) return 100
  return Math.min(100, Math.floor((progress.done / progress.total) * 100))
}

/** A queued task that already ran is waiting to retry. */
export function statusLabel(
  t: TFunction,
  task: Pick<TaskView, 'status' | 'attempts' | 'maxAttempts'>,
) {
  if (task.status === 'queued' && task.attempts > 0) {
    return t('activity.status.retrying', { attempt: task.attempts + 1, max: task.maxAttempts })
  }
  return t(`activity.status.${task.status}`)
}
