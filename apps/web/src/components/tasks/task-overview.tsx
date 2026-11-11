import type { TaskView } from '@arrakit/contract'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { CircleCheck, ListChecks } from 'lucide-react'
import { useState } from 'react'
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
import { useCurrentUser } from '#/lib/current-user'
import { moment } from '#/lib/format'
import { orpc } from '#/lib/orpc'

import { errorOf, taskTitle } from './task-copy'
import { TaskProgress, TaskStatus } from './task-status'
import { activeTasksQuery, finishedTasksQuery } from './use-tasks'

const K = 'tasks'

type Tab = 'active' | 'finished'

/**
 * The tasks in progress and the finished ones, of one workspace or, without `workspaceId`, of the
 * whole organization, with where each one runs.
 */
export function TaskOverview({ workspaceId }: { workspaceId?: string }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('active')
  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
      <TabsList>
        <TabsTrigger value="active">{t(`${K}.tabs.active`)}</TabsTrigger>
        <TabsTrigger value="finished">{t(`${K}.tabs.finished`)}</TabsTrigger>
      </TabsList>
      <TabsContent value="active">
        <ActiveTasks workspaceId={workspaceId} />
      </TabsContent>
      <TabsContent value="finished">
        <FinishedTasks workspaceId={workspaceId} />
      </TabsContent>
    </Tabs>
  )
}

function ActiveTasks({ workspaceId }: { workspaceId?: string }) {
  const { t } = useTranslation()
  const tasks = useQuery({
    ...activeTasksQuery(workspaceId),
    meta: { failure: t(`${K}.notLoaded`) },
  })
  if (!tasks.data) return null
  if (tasks.data.tasks.length === 0) {
    return <EmptyState icon={ListChecks} title={t(`${K}.empty.active`)} />
  }
  return (
    <TaskTable label={t(`${K}.tabs.active`)} tasks={tasks.data.tasks} showsWhere={!workspaceId} />
  )
}

function FinishedTasks({ workspaceId }: { workspaceId?: string }) {
  const { t } = useTranslation()
  const pages = useInfiniteQuery({
    ...finishedTasksQuery(workspaceId),
    meta: { failure: t(`${K}.notLoaded`) },
  })
  if (!pages.data) return null
  const tasks = pages.data.pages.flatMap((page) => page.tasks)
  if (tasks.length === 0) {
    return <EmptyState icon={CircleCheck} title={t(`${K}.empty.finished`)} />
  }
  return (
    <div className="flex flex-col items-center gap-4">
      <TaskTable label={t(`${K}.tabs.finished`)} tasks={tasks} showsWhere={!workspaceId} />
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

/** The names of the workspaces the person may read, by id. */
function useWorkspaceNames(enabled: boolean): Map<string, string> {
  const { can } = useCurrentUser()
  const workspaces = useQuery({
    ...orpc.workspaces.list.queryOptions(),
    enabled: enabled && can({ workspace: ['read'] }),
  })
  return new Map((workspaces.data ?? []).map((workspace) => [workspace.id, workspace.name]))
}

function TaskTable({
  label,
  tasks,
  showsWhere,
}: {
  label: string
  tasks: TaskView[]
  showsWhere: boolean
}) {
  const { t } = useTranslation()
  const names = useWorkspaceNames(showsWhere)
  const whereOf = (task: TaskView) =>
    task.workspaceId
      ? (names.get(task.workspaceId) ?? t(`${K}.nobody`))
      : t(`${K}.organizationWide`)
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>{t(`${K}.columns.task`)}</TableHead>
          {showsWhere ? <TableHead>{t(`${K}.columns.where`)}</TableHead> : null}
          <TableHead>{t(`${K}.columns.status`)}</TableHead>
          <TableHead>{t(`${K}.columns.progress`)}</TableHead>
          <TableHead>{t(`${K}.columns.requestedBy`)}</TableHead>
          <TableHead>{t(`${K}.columns.when`)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} where={showsWhere ? whereOf(task) : undefined} />
        ))}
      </TableBody>
    </Table>
  )
}

function TaskRow({ task, where }: { task: TaskView; where?: string }) {
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
      {where === undefined ? null : <TableCell>{where}</TableCell>}
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
