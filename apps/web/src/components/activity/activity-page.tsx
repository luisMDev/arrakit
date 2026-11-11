import type { TaskView } from '@arrakit/contract'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Activity, CircleCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '#/components/shell/empty-state'
import { Button } from '#/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { useMember } from '#/lib/current-user'
import { moment } from '#/lib/format'

import { errorOf, taskTitle } from './task-copy'
import { TaskProgress, TaskStatus } from './task-status'
import { activeTasksQuery, finishedTasksQuery } from './use-tasks'

const K = 'activity'

export type ActivityTab = 'active' | 'finished'

export function ActivityPage({ tab = 'active' }: { tab?: ActivityTab }) {
  const { t } = useTranslation()
  const me = useMember()
  const navigate = useNavigate()
  const seesAll = me.can({ task: ['read'] })

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t(`${K}.title`)}</h1>
        <p className="text-muted-foreground">
          {seesAll
            ? t(`${K}.hint`, { organization: me.user.organization.name })
            : t(`${K}.hintOwn`)}
        </p>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) =>
          void navigate({ to: '/app/activity', search: { tab: value as ActivityTab } })
        }
      >
        <TabsList>
          <TabsTrigger value="active">{t(`${K}.tabs.active`)}</TabsTrigger>
          <TabsTrigger value="finished">{t(`${K}.tabs.finished`)}</TabsTrigger>
        </TabsList>
        <TabsContent value="active">
          <ActiveTasks />
        </TabsContent>
        <TabsContent value="finished">
          <FinishedTasks />
        </TabsContent>
      </Tabs>
    </main>
  )
}

function ActiveTasks() {
  const { t } = useTranslation()
  const tasks = useQuery({ ...activeTasksQuery(), meta: { failure: t(`${K}.notLoaded`) } })
  if (!tasks.data) return null
  if (tasks.data.tasks.length === 0) {
    return <EmptyState icon={Activity} title={t(`${K}.empty.active`)} />
  }
  return <TaskTable label={t(`${K}.tabs.active`)} tasks={tasks.data.tasks} />
}

function FinishedTasks() {
  const { t } = useTranslation()
  const pages = useInfiniteQuery({
    ...finishedTasksQuery(),
    meta: { failure: t(`${K}.notLoaded`) },
  })
  if (!pages.data) return null
  const tasks = pages.data.pages.flatMap((page) => page.tasks)
  if (tasks.length === 0) {
    return <EmptyState icon={CircleCheck} title={t(`${K}.empty.finished`)} />
  }
  return (
    <div className="flex flex-col items-center gap-4">
      <TaskTable label={t(`${K}.tabs.finished`)} tasks={tasks} />
      {pages.hasNextPage ? (
        <Button
          variant="outline"
          disabled={pages.isFetchingNextPage}
          onClick={() => void pages.fetchNextPage()}
        >
          {t(`${K}.loadMore`)}
        </Button>
      ) : null}
    </div>
  )
}

function TaskTable({ label, tasks }: { label: string; tasks: TaskView[] }) {
  const { t } = useTranslation()
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>{t(`${K}.columns.task`)}</TableHead>
          <TableHead>{t(`${K}.columns.status`)}</TableHead>
          <TableHead>{t(`${K}.columns.progress`)}</TableHead>
          <TableHead>{t(`${K}.columns.requestedBy`)}</TableHead>
          <TableHead>{t(`${K}.columns.when`)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </TableBody>
    </Table>
  )
}

function TaskRow({ task }: { task: TaskView }) {
  const { t } = useTranslation()
  const requester = task.requestedByYou ? t(`${K}.you`) : (task.requesterName ?? t(`${K}.nobody`))
  return (
    <TableRow data-task={task.id}>
      <TableCell className="whitespace-normal">
        <span className="font-medium">{taskTitle(t, task)}</span>
        {task.status === 'failed' && task.errorCode ? (
          <span className="text-destructive block text-sm">{errorOf(t, task.errorCode)}</span>
        ) : null}
      </TableCell>
      <TableCell>
        <TaskStatus task={task} />
      </TableCell>
      <TableCell>
        <TaskProgress task={task} />
      </TableCell>
      <TableCell>{requester}</TableCell>
      <TableCell className="text-muted-foreground">
        {moment(task.finishedAt ?? task.startedAt ?? task.createdAt)}
      </TableCell>
    </TableRow>
  )
}
