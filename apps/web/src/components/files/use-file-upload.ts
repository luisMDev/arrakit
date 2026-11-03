import { type FilePolicy, type Plan, filePolicyFor, fileRefusal } from '@arrakit/plans'
import { useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { statusOf } from '#/lib/api-errors'
import { useMember } from '#/lib/current-user'
import { fileSize, listing } from '#/lib/format'
import { notify } from '#/lib/notify'
import { client, orpc } from '#/lib/orpc'
import { putFile } from '#/lib/upload'

const K = 'files.upload'

export interface UploadItem {
  key: string
  name: string
  /** From 0 to 1. */
  progress: number
  /** Why it failed, when it did. */
  error?: string
}

function refusalOf(file: File, policy: FilePolicy, t: TFunction): string | undefined {
  switch (fileRefusal({ name: file.name, sizeBytes: file.size }, policy)) {
    case 'name':
      return t(`${K}.badName`)
    case 'type':
      return t(`${K}.typeRefused`, { extensions: listing(Object.keys(policy.types)) })
    case 'size':
      return t(`${K}.tooLarge`, { size: fileSize(policy.maxBytes) })
    default:
      return undefined
  }
}

const FAILURES: Record<number, string> = {
  400: 'refused',
  402: 'noSpace',
  403: 'notAllowed',
  409: 'taken',
}

const failureOf = (err: unknown, name: string, t: TFunction): string =>
  t(`${K}.${FAILURES[statusOf(err)] ?? 'failed'}`, { file: name })

let nextKey = 0

/** Uploads files to the organization, or to a workspace, showing each one's progress. */
export function useFileUpload(workspaceId?: string) {
  const { t } = useTranslation()
  const me = useMember()
  const queryClient = useQueryClient()
  const policy = filePolicyFor(me.user.plan as Plan)
  const [items, setItems] = useState<UploadItem[]>([])

  const change = (key: string, patch: Partial<UploadItem>) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  const dismiss = (key: string) => setItems((current) => current.filter((item) => item.key !== key))

  async function uploadOne(file: File, key: string) {
    const refused = refusalOf(file, policy, t)
    if (refused) return change(key, { error: refused })
    try {
      const ticket = await client.files.requestUpload({
        workspaceId,
        name: file.name,
        sizeBytes: file.size,
      })
      await putFile(ticket.upload, file, (progress) => change(key, { progress }))
      await client.files.completeUpload({ id: ticket.file.id })
      dismiss(key)
      notify.success(t('files.uploaded', { file: file.name }))
    } catch (err) {
      change(key, { error: failureOf(err, file.name, t) })
    }
  }

  async function start(files: readonly File[]) {
    const added = files.map((file) => ({ file, key: `upload-${(nextKey += 1)}` }))
    setItems((current) => [
      ...current,
      ...added.map(({ file, key }) => ({ key, name: file.name, progress: 0 })),
    ])
    await Promise.all(added.map(({ file, key }) => uploadOne(file, key)))
    await queryClient.invalidateQueries({ queryKey: orpc.files.list.key() })
  }

  return { items, start, dismiss }
}
