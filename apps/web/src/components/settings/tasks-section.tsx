import { useTranslation } from 'react-i18next'

import { TaskOverview } from '#/components/tasks/task-overview'
import { useMember } from '#/lib/current-user'

import { SettingsSectionLayout } from './settings-ui'

/** Settings > Tasks: background work across the organization, every workspace included. */
export function TasksSection() {
  const { t } = useTranslation()
  const me = useMember()
  return (
    <SettingsSectionLayout id="tasks" title={t('tasks.title')}>
      <p className="text-muted-foreground text-sm">
        {me.can({ task: ['read'] })
          ? t('tasks.hint', { organization: me.user.organization.name })
          : t('tasks.hintOwn')}
      </p>
      <TaskOverview />
    </SettingsSectionLayout>
  )
}
