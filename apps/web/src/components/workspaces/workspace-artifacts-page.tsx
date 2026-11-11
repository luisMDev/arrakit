import { useTranslation } from 'react-i18next'

import { ArtifactList } from '#/components/artifacts/artifact-list'

import { useWorkspace } from './use-workspace'

/** The artifacts of one workspace. */
export function WorkspaceArtifactsPage({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const workspace = useWorkspace(workspaceId)
  if (!workspace.data) return <main />

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('artifacts.title')}</h1>
        <p className="text-muted-foreground">
          {t('artifacts.hint', { workspace: workspace.data.name })}
        </p>
      </div>
      <ArtifactList workspaceId={workspaceId} />
    </main>
  )
}
