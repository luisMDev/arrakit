import type { TaskView } from '@arrakit/contract'
import { useQuery } from '@tanstack/react-query'
import { Link, useMatchRoute } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#/components/ui/sidebar'
import { Spinner } from '#/components/ui/spinner'
import { notify } from '#/lib/notify'

import { errorOf, taskTitle } from './task-copy'
import { TaskProgress } from './task-status'
import { activeTasksQuery, useTaskWatch } from './use-tasks'

const SHOWN = 5

/**
 * How many tasks are in progress, with the first few and how far along they are. It keeps the
 * task lists current while any task runs or Activity is open, and tells the person when one they
 * started finishes.
 */
export function ActivityIndicator() {
  const { t } = useTranslation()
  const matchRoute = useMatchRoute()
  const [open, setOpen] = useState(false)
  const active = useQuery(activeTasksQuery()).data?.tasks ?? []
  const onActivity = Boolean(matchRoute({ to: '/app/activity' }))

  const announce = useCallback(
    (task: TaskView) => {
      if (!task.requestedByYou) return
      const title = taskTitle(t, task)
      if (task.status === 'succeeded')
        notify.success(t('activity.notices.succeeded', { task: title }))
      else {
        notify.error(t('activity.notices.failed', { task: title }), {
          description: task.errorCode ? errorOf(t, task.errorCode) : undefined,
        })
      }
    },
    [t],
  )
  useTaskWatch(active.length > 0 || onActivity, announce)

  if (active.length === 0) return null
  const label = t('activity.indicator.label', { count: active.length })
  return (
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <SidebarMenuButton tooltip={label} aria-label={label}>
                <Spinner />
                <span>{label}</span>
              </SidebarMenuButton>
            </PopoverTrigger>
            <PopoverContent side="right" align="end" className="flex w-80 flex-col gap-3">
              <ul aria-label={label} className="flex flex-col gap-3">
                {active.slice(0, SHOWN).map((task) => (
                  <li key={task.id} className="flex flex-col gap-1">
                    <span className="truncate text-sm font-medium">{taskTitle(t, task)}</span>
                    <TaskProgress task={task} />
                  </li>
                ))}
              </ul>
              <Link
                to="/app/activity"
                search={{ tab: 'active' }}
                className="text-sm underline-offset-4 hover:underline"
                onClick={() => setOpen(false)}
              >
                {t('activity.indicator.viewAll')}
              </Link>
            </PopoverContent>
          </Popover>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  )
}
