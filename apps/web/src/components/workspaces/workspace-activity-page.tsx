import { useTranslation } from 'react-i18next'

import { TaskActivity } from '#/components/activity/task-activity'
import { useMember } from '#/lib/current-user'

import { useWorkspace } from './use-workspace'

/** The background work of one workspace. */
export function WorkspaceActivityPage({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const me = useMember()
  const workspace = useWorkspace(workspaceId)
  if (!workspace.data) return <main />

  const names = { workspace: workspace.data.name }
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('activity.title')}</h1>
        <p className="text-muted-foreground">
          {me.can({ task: ['read'] })
            ? t('activity.workspaceHint', names)
            : t('activity.workspaceHintOwn', names)}
        </p>
      </div>
      <TaskActivity workspaceId={workspaceId} />
    </main>
  )
}
