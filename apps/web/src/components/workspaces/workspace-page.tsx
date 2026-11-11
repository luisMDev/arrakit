import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import { useMember } from '#/lib/current-user'

import { useWorkspace } from './use-workspace'

const K = 'workspaces'

/** A workspace's Home: where the product's own dashboard for a workspace starts. */
export function WorkspacePage({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const me = useMember()
  const workspace = useWorkspace(workspaceId)
  if (!workspace.data) return <main />

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{workspace.data.name}</h1>
        {workspace.data.description ? (
          <p className="text-muted-foreground">{workspace.data.description}</p>
        ) : null}
        <p className="text-muted-foreground">
          {t(`${K}.home`, { organization: me.user.organization.name })}
        </p>
      </div>
      {me.can({ file: ['read'] }) ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/app/workspaces/$workspaceId/library" params={{ workspaceId }}>
              {t(`${K}.library`)}
            </Link>
          </Button>
        </div>
      ) : null}
    </main>
  )
}
