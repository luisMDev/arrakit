import type { Artifact } from '@arrakit/contract'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { FileCode, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '#/components/settings/confirm-dialog'
import { EmptyState } from '#/components/shell/empty-state'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { useMember } from '#/lib/current-user'
import { moment } from '#/lib/format'
import { notify } from '#/lib/notify'
import { orpc } from '#/lib/orpc'
import { useApiMutation } from '#/lib/use-api-mutation'

import { ArtifactFormDialog } from './artifact-form-dialog'
import { RenameArtifactDialog } from './rename-artifact-dialog'
import { useArtifactActions } from './use-artifact-actions'

const K = 'artifacts'

/** The artifacts of one workspace, most recently changed first: create, open, rename, delete. */
export function ArtifactList({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const me = useMember()
  const artifacts = useQuery({
    ...orpc.artifacts.list.queryOptions({ input: { workspaceId } }),
    meta: { failure: t(`${K}.notLoaded`) },
  })
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<Artifact>()

  return (
    <section className="flex flex-col gap-4">
      {me.can({ artifact: ['create'] }) ? (
        <div>
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t(`${K}.new`)}
          </Button>
        </div>
      ) : null}
      {artifacts.data?.length === 0 ? (
        <EmptyState icon={FileCode} title={t(`${K}.empty`)} />
      ) : artifacts.data ? (
        <Table aria-label={t(`${K}.table`)}>
          <TableHeader>
            <TableRow>
              <TableHead>{t(`${K}.titleColumn`)}</TableHead>
              <TableHead>{t(`${K}.format`)}</TableHead>
              <TableHead>{t(`${K}.version`)}</TableHead>
              <TableHead>{t(`${K}.createdBy`)}</TableHead>
              <TableHead>{t(`${K}.updated`)}</TableHead>
              <TableHead>
                <span className="sr-only">{t(`${K}.actions`)}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {artifacts.data.map((artifact) => (
              <ArtifactRow
                key={artifact.id}
                artifact={artifact}
                workspaceId={workspaceId}
                onRename={() => setRenaming(artifact)}
              />
            ))}
          </TableBody>
        </Table>
      ) : null}
      <ArtifactFormDialog open={creating} onOpenChange={setCreating} workspaceId={workspaceId} />
      <RenameArtifactDialog artifact={renaming} onClose={() => setRenaming(undefined)} />
    </section>
  )
}

function ArtifactRow({
  artifact,
  workspaceId,
  onRename,
}: {
  artifact: Artifact
  workspaceId: string
  onRename: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { canChange, canDelete } = useArtifactActions(artifact)
  const [confirming, setConfirming] = useState(false)
  const names = { artifact: artifact.title }

  const remove = useApiMutation({
    ...orpc.artifacts.delete.mutationOptions(),
    onSuccess: async () => {
      setConfirming(false)
      await queryClient.invalidateQueries({ queryKey: orpc.artifacts.list.key() })
      notify.success(t(`${K}.deleted`, names))
    },
    meta: { failure: t(`${K}.notDeleted`) },
  })

  return (
    <TableRow data-artifact={artifact.title}>
      <TableCell className="max-w-64 truncate font-medium">
        <Link
          to="/app/workspaces/$workspaceId/artifacts/$artifactId"
          params={{ workspaceId, artifactId: artifact.id }}
          className="hover:underline"
        >
          {artifact.title}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant="secondary">{t(`${K}.formats.${artifact.format}`)}</Badge>
      </TableCell>
      <TableCell>{t(`${K}.versionNumber`, { version: artifact.currentVersion })}</TableCell>
      <TableCell>{artifact.creatorName || t(`${K}.someone`)}</TableCell>
      <TableCell>{moment(artifact.updatedAt)}</TableCell>
      <TableCell className="text-right">
        {canChange || canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t(`${K}.actionsOf`, names)}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canChange ? (
                <DropdownMenuItem onSelect={onRename}>
                  <Pencil />
                  {t(`${K}.rename`)}
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
                  <Trash2 />
                  {t(`${K}.delete`)}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t(`${K}.confirmDeleteTitle`, names)}
          description={t(`${K}.confirmDeleteHint`)}
          confirmLabel={t(`${K}.delete`)}
          pending={remove.isPending}
          onConfirm={() => void remove.run({ id: artifact.id })}
        />
      </TableCell>
    </TableRow>
  )
}
