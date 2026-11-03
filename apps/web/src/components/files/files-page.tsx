import { useTranslation } from 'react-i18next'

import { useMember } from '#/lib/current-user'

import { FileBrowser } from './file-browser'

export function FilesPage() {
  const { t } = useTranslation()
  const me = useMember()
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('files.title')}</h1>
        <p className="text-muted-foreground">
          {t('files.hint', { organization: me.user.organization.name })}
        </p>
      </div>
      <FileBrowser />
    </main>
  )
}
