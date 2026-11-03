import type { Workspace } from '@arrakit/contract'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderKanban, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '#/components/settings/confirm-dialog'
import { EmptyState } from '#/components/shell/empty-state'
import { Button } from '#/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { useMember } from '#/lib/current-user'
import { fullDay } from '#/lib/format'
import { notify } from '#/lib/notify'
import { orpc } from '#/lib/orpc'
import { useApiMutation } from '#/lib/use-api-mutation'

import { WorkspaceFormDialog } from './workspace-form-dialog'

const K = 'workspaces'

export function WorkspacesPage() {
  const { t } = useTranslation()
  const me = useMember()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Workspace>()
  const openDialog = (workspace?: Workspace) => {
    setEditing(workspace)
    setDialogOpen(true)
  }
  const workspaces = useQuery({
    ...orpc.workspaces.list.queryOptions(),
    meta: { failure: t(`${K}.notLoaded`) },
  })

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{t(`${K}.title`)}</h1>
          <p className="text-muted-foreground">
            {t(`${K}.hint`, { organization: me.user.organization.name })}
          </p>
        </div>
        {me.can({ workspace: ['create'] }) ? (
          <Button onClick={() => openDialog()}>
            <Plus />
            {t(`${K}.new`)}
          </Button>
        ) : null}
      </div>
      {workspaces.data?.length === 0 ? (
        <EmptyState icon={FolderKanban} title={t(`${K}.empty`)} />
      ) : workspaces.data ? (
        <ul aria-label={t(`${K}.title`)} className="flex flex-col gap-3">
          {workspaces.data.map((workspace) => (
            <li key={workspace.id}>
              <WorkspaceCard workspace={workspace} onEdit={() => openDialog(workspace)} />
            </li>
          ))}
        </ul>
      ) : null}
      <WorkspaceFormDialog workspace={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
    </main>
  )
}

function WorkspaceCard({ workspace, onEdit }: { workspace: Workspace; onEdit: () => void }) {
  const { t } = useTranslation()
  const me = useMember()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const names = { workspace: workspace.name }

  const remove = useApiMutation({
    ...orpc.workspaces.delete.mutationOptions(),
    onSuccess: async () => {
      setConfirming(false)
      await queryClient.invalidateQueries({ queryKey: orpc.workspaces.list.key() })
      notify.success(t(`${K}.deleted`, names))
    },
    meta: { failure: t(`${K}.notDeleted`) },
  })

  return (
    <Card data-workspace={workspace.name}>
      <CardHeader>
        <CardTitle>{workspace.name}</CardTitle>
        <CardDescription className="flex flex-col gap-1">
          {workspace.description ? <span>{workspace.description}</span> : null}
          <span>{t(`${K}.createdOn`, { date: fullDay(workspace.createdOn) })}</span>
        </CardDescription>
        <CardAction className="flex gap-1">
          {me.can({ workspace: ['update'] }) ? (
            <Button variant="ghost" size="sm" aria-label={t(`${K}.editOf`, names)} onClick={onEdit}>
              {t(`${K}.edit`)}
            </Button>
          ) : null}
          {me.can({ workspace: ['delete'] }) ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={t(`${K}.deleteOf`, names)}
              onClick={() => setConfirming(true)}
            >
              {t(`${K}.delete`)}
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t(`${K}.confirmDeleteTitle`, names)}
        confirmLabel={t(`${K}.delete`)}
        pending={remove.isPending}
        onConfirm={() => void remove.run({ id: workspace.id })}
      />
    </Card>
  )
}
