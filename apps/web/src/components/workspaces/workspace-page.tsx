import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { FileBrowser } from '#/components/files/file-browser'
import { Button } from '#/components/ui/button'
import { useMember } from '#/lib/current-user'
import { orpc } from '#/lib/orpc'

const K = 'workspaces'

/** One workspace and its files. */
export function WorkspacePage({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const me = useMember()
  const workspace = useQuery({
    ...orpc.workspaces.get.queryOptions({ input: { id: workspaceId } }),
    meta: { failure: t(`${K}.notLoadedOne`) },
  })

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <Button variant="ghost" size="sm" className="self-start" asChild>
        <Link to="/app/workspaces">
          <ArrowLeft />
          {t(`${K}.back`)}
        </Link>
      </Button>
      {workspace.data ? (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{workspace.data.name}</h1>
            {workspace.data.description ? (
              <p className="text-muted-foreground">{workspace.data.description}</p>
            ) : null}
          </div>
          {me.can({ file: ['read'] }) ? (
            <div className="flex flex-col gap-4">
              <h2 className="text-xl font-semibold">{t(`${K}.files`)}</h2>
              <FileBrowser workspaceId={workspaceId} />
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  )
}
