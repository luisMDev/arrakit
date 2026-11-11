import { useTranslation } from 'react-i18next'

import { FileBrowser } from '#/components/files/file-browser'

import { useWorkspace } from './use-workspace'

const K = 'workspaces'

/** The files of one workspace. */
export function WorkspaceLibraryPage({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const workspace = useWorkspace(workspaceId)
  if (!workspace.data) return <main />

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t(`${K}.library`)}</h1>
        <p className="text-muted-foreground">
          {t(`${K}.libraryHint`, { workspace: workspace.data.name })}
        </p>
      </div>
      <FileBrowser workspaceId={workspaceId} />
    </main>
  )
}
