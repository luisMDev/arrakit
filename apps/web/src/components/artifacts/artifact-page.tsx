import type { Artifact } from '@arrakit/contract'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Download, FileCode, Pencil, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '#/components/settings/confirm-dialog'
import { EmptyState } from '#/components/shell/empty-state'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { moment } from '#/lib/format'
import { notify } from '#/lib/notify'
import { orpc } from '#/lib/orpc'
import { useApiMutation } from '#/lib/use-api-mutation'

import { ArtifactFormDialog } from './artifact-form-dialog'
import { downloadSource } from './artifact-source'
import { ArtifactView } from './artifact-view'
import { RenameArtifactDialog } from './rename-artifact-dialog'
import { useArtifactActions } from './use-artifact-actions'

const K = 'artifacts'

/** One artifact of a workspace: any of its versions, and what the person may do to it. */
export function ArtifactPage({
  workspaceId,
  artifactId,
}: {
  workspaceId: string
  artifactId: string
}) {
  const { t } = useTranslation()
  const artifact = useQuery({
    ...orpc.artifacts.get.queryOptions({ input: { id: artifactId } }),
    meta: { failure: t(`${K}.notLoadedOne`) },
  })

  if (!artifact.data) return <main />
  if (artifact.data.workspaceId !== workspaceId) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
        <EmptyState icon={FileCode} title={t(`${K}.notHere`)} />
      </main>
    )
  }
  return <ArtifactScreen artifact={artifact.data} workspaceId={workspaceId} />
}

function ArtifactScreen({ artifact, workspaceId }: { artifact: Artifact; workspaceId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { canChange, canDelete } = useArtifactActions(artifact)
  const [chosen, setChosen] = useState<number>()
  const [publishing, setPublishing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const version = chosen ?? artifact.currentVersion
  const names = { artifact: artifact.title }

  const versions = useQuery({
    ...orpc.artifacts.versions.queryOptions({ input: { id: artifact.id } }),
    meta: { failure: t(`${K}.versionsNotLoaded`) },
  })
  const content = useQuery({
    ...orpc.artifacts.content.queryOptions({ input: { id: artifact.id, version } }),
    meta: { failure: t(`${K}.contentNotLoaded`) },
  })
  const backToList = () =>
    navigate({ to: '/app/workspaces/$workspaceId/artifacts', params: { workspaceId } })
  const remove = useApiMutation({
    ...orpc.artifacts.delete.mutationOptions(),
    onSuccess: async () => {
      setConfirming(false)
      await backToList()
      await queryClient.invalidateQueries({ queryKey: orpc.artifacts.list.key() })
      notify.success(t(`${K}.deleted`, names))
    },
    meta: { failure: t(`${K}.notDeleted`) },
  })

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" className="self-start" asChild>
          <Link to="/app/workspaces/$workspaceId/artifacts" params={{ workspaceId }}>
            <ArrowLeft />
            {t(`${K}.back`)}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{artifact.title}</h1>
          <Badge variant="secondary">{t(`${K}.formats.${artifact.format}`)}</Badge>
        </div>
        <p className="text-muted-foreground">
          {t(`${K}.byline`, {
            person: artifact.creatorName || t(`${K}.someone`),
            moment: moment(artifact.updatedAt),
          })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(version)} onValueChange={(value) => setChosen(Number(value))}>
          <SelectTrigger aria-label={t(`${K}.chooseVersion`)} className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(versions.data ?? [{ number: version, publishedAt: artifact.updatedAt }]).map((v) => (
              <SelectItem key={v.number} value={String(v.number)}>
                {t(`${K}.versionAt`, { version: v.number, moment: moment(v.publishedAt) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          disabled={!content.data}
          onClick={() =>
            content.data && downloadSource(artifact.title, artifact.format, content.data.content)
          }
        >
          <Download />
          {t(`${K}.download`)}
        </Button>
        {canChange ? (
          <>
            <Button variant="outline" onClick={() => setPublishing(true)}>
              <Upload />
              {t(`${K}.newVersion`)}
            </Button>
            <Button variant="outline" onClick={() => setRenaming(true)}>
              <Pencil />
              {t(`${K}.rename`)}
            </Button>
          </>
        ) : null}
        {canDelete ? (
          <Button variant="outline" onClick={() => setConfirming(true)}>
            <Trash2 />
            {t(`${K}.delete`)}
          </Button>
        ) : null}
      </div>
      {content.data ? (
        <ArtifactView
          title={artifact.title}
          format={content.data.format}
          content={content.data.content}
        />
      ) : null}
      <ArtifactFormDialog
        open={publishing}
        onOpenChange={setPublishing}
        artifact={artifact}
        onSaved={() => setChosen(undefined)}
      />
      <RenameArtifactDialog
        artifact={renaming ? artifact : undefined}
        onClose={() => setRenaming(false)}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t(`${K}.confirmDeleteTitle`, names)}
        description={t(`${K}.confirmDeleteHint`)}
        confirmLabel={t(`${K}.delete`)}
        pending={remove.isPending}
        onConfirm={() => void remove.run({ id: artifact.id })}
      />
    </main>
  )
}
