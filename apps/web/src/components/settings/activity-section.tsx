import { useTranslation } from 'react-i18next'

import { TaskActivity } from '#/components/activity/task-activity'
import { useMember } from '#/lib/current-user'

import { SettingsSectionLayout } from './settings-ui'

/** Settings > Activity: background work across the organization, every workspace included. */
export function ActivitySection() {
  const { t } = useTranslation()
  const me = useMember()
  return (
    <SettingsSectionLayout id="activity" title={t('activity.title')}>
      <p className="text-muted-foreground text-sm">
        {me.can({ task: ['read'] })
          ? t('activity.hint', { organization: me.user.organization.name })
          : t('activity.hintOwn')}
      </p>
      <TaskActivity />
    </SettingsSectionLayout>
  )
}
