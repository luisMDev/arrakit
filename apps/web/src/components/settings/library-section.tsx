import { useTranslation } from 'react-i18next'

import { FileBrowser } from '#/components/files/file-browser'
import { useCurrentUser } from '#/lib/current-user'

import { SettingsSectionLayout } from './settings-ui'

/** Settings > Library: the files the whole organization shares, outside any workspace. */
export function LibrarySection() {
  const { t } = useTranslation()
  const { user } = useCurrentUser()
  return (
    <SettingsSectionLayout id="library" title={t('files.title')}>
      <p className="text-muted-foreground text-sm">
        {t('files.hint', { organization: user?.organization?.name })}
      </p>
      <FileBrowser />
    </SettingsSectionLayout>
  )
}
