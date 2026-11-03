import type { FileView } from '@arrakit/contract'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, MoreHorizontal, Pencil, Trash2, Upload, X } from 'lucide-react'
import { type DragEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '#/components/settings/confirm-dialog'
import { EmptyState } from '#/components/shell/empty-state'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Progress } from '#/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { useMember } from '#/lib/current-user'
import { fileSize, fullDay } from '#/lib/format'
import { notify } from '#/lib/notify'
import { orpc } from '#/lib/orpc'
import { useApiMutation } from '#/lib/use-api-mutation'

import { RenameFileDialog } from './rename-file-dialog'
import { type UploadItem, useFileUpload } from './use-file-upload'

const K = 'files'

/** The files of the organization, or of one workspace: upload, list, download, rename, delete. */
export function FileBrowser({ workspaceId }: { workspaceId?: string }) {
  const { t } = useTranslation()
  const me = useMember()
  const files = useQuery({
    ...orpc.files.list.queryOptions({ input: { workspaceId } }),
    meta: { failure: t(`${K}.notLoaded`) },
  })
  const upload = useFileUpload(workspaceId)
  const [renaming, setRenaming] = useState<FileView>()

  return (
    <section className="flex flex-col gap-4">
      {me.can({ file: ['upload'] }) ? (
        <DropZone onFiles={(picked) => void upload.start(picked)} />
      ) : null}
      {upload.items.length > 0 ? (
        <ul aria-label={t(`${K}.uploading`)} className="flex flex-col gap-2">
          {upload.items.map((item) => (
            <UploadRow key={item.key} item={item} onDismiss={() => upload.dismiss(item.key)} />
          ))}
        </ul>
      ) : null}
      {files.data?.length === 0 ? (
        <EmptyState icon={FileText} title={t(`${K}.empty`)} />
      ) : files.data ? (
        <Table aria-label={t(`${K}.title`)}>
          <TableHeader>
            <TableRow>
              <TableHead>{t(`${K}.name`)}</TableHead>
              <TableHead>{t(`${K}.size`)}</TableHead>
              <TableHead>{t(`${K}.uploadedBy`)}</TableHead>
              <TableHead>{t(`${K}.uploadedOn`)}</TableHead>
              <TableHead>
                <span className="sr-only">{t(`${K}.actions`)}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.data.map((file) => (
              <FileRow key={file.id} file={file} onRename={() => setRenaming(file)} />
            ))}
          </TableBody>
        </Table>
      ) : null}
      <RenameFileDialog file={renaming} onClose={() => setRenaming(undefined)} />
    </section>
  )
}

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const drop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    if (event.dataTransfer.files.length > 0) onFiles([...event.dataTransfer.files])
  }

  return (
    <div
      data-dragging={over ? true : undefined}
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center data-[dragging]:bg-muted"
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <p className="text-sm text-muted-foreground">{t(`${K}.dropHint`)}</p>
      <Button variant="outline" onClick={() => input.current?.click()}>
        <Upload />
        {t(`${K}.choose`)}
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        aria-label={t(`${K}.choose`)}
        onChange={(event) => {
          const picked = [...(event.target.files ?? [])]
          event.target.value = ''
          if (picked.length > 0) onFiles(picked)
        }}
      />
    </div>
  )
}

function UploadRow({ item, onDismiss }: { item: UploadItem; onDismiss: () => void }) {
  const { t } = useTranslation()
  return (
    <li data-upload={item.name} className="flex items-center gap-3 rounded-md border p-3 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="truncate font-medium">{item.name}</span>
        {item.error ? (
          <span role="alert" className="text-destructive">
            {item.error}
          </span>
        ) : (
          <Progress
            value={Math.round(item.progress * 100)}
            aria-label={t(`${K}.progressOf`, { file: item.name })}
          />
        )}
      </div>
      {item.error ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t(`${K}.dismissOf`, { file: item.name })}
          onClick={onDismiss}
        >
          <X />
        </Button>
      ) : null}
    </li>
  )
}

function FileRow({ file, onRename }: { file: FileView; onRename: () => void }) {
  const { t } = useTranslation()
  const me = useMember()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const names = { file: file.name }
  const canRename = file.uploadedByYou || me.can({ file: ['update'] })
  const canDelete = file.uploadedByYou || me.can({ file: ['delete'] })

  const download = useApiMutation({
    ...orpc.files.downloadUrl.mutationOptions(),
    onSuccess: ({ url }) => window.location.assign(url),
    meta: { failure: t(`${K}.notDownloaded`) },
  })
  const remove = useApiMutation({
    ...orpc.files.delete.mutationOptions(),
    onSuccess: async () => {
      setConfirming(false)
      await queryClient.invalidateQueries({ queryKey: orpc.files.list.key() })
      notify.success(t(`${K}.deleted`, names))
    },
    meta: { failure: t(`${K}.notDeleted`) },
  })

  return (
    <TableRow data-file={file.name}>
      <TableCell className="max-w-64 truncate font-medium">{file.name}</TableCell>
      <TableCell>{fileSize(file.sizeBytes)}</TableCell>
      <TableCell>{file.uploaderName || t(`${K}.someone`)}</TableCell>
      <TableCell>{fullDay(file.uploadedOn)}</TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t(`${K}.actionsOf`, names)}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void download.run({ id: file.id })}>
              <Download />
              {t(`${K}.download`)}
            </DropdownMenuItem>
            {canRename ? (
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
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t(`${K}.confirmDeleteTitle`, names)}
          confirmLabel={t(`${K}.delete`)}
          pending={remove.isPending}
          onConfirm={() => void remove.run({ id: file.id })}
        />
      </TableCell>
    </TableRow>
  )
}
