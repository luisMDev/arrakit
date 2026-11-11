import type { TaskView } from '@arrakit/contract'
import { useTranslation } from 'react-i18next'

import { Badge } from '#/components/ui/badge'
import { Progress } from '#/components/ui/progress'
import { Spinner } from '#/components/ui/spinner'

import { percentOf, statusLabel, taskTitle } from './task-copy'

const VARIANTS = {
  queued: 'outline',
  running: 'secondary',
  succeeded: 'default',
  failed: 'destructive',
} as const

export function TaskStatus({ task }: { task: TaskView }) {
  const { t } = useTranslation()
  return <Badge variant={VARIANTS[task.status]}>{statusLabel(t, task)}</Badge>
}

/** A bar with its percentage, or a spinner while how much work there is is not known. */
export function TaskProgress({ task }: { task: TaskView }) {
  const { t } = useTranslation()
  const percent = percentOf(task)
  if (percent === null) {
    return (
      <span className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner />
        {t('activity.working')}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-2">
      <Progress
        value={percent}
        className="w-24"
        aria-label={t('activity.progressLabel', { task: taskTitle(t, task), percent })}
      />
      <span className="text-muted-foreground w-10 text-sm tabular-nums">{percent}%</span>
    </span>
  )
}
