import type { FilePolicyView } from '@arrakit/contract'
import { fileRefusal } from '@arrakit/plans'
import { ORPCError } from '@orpc/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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

/** Why the policy refuses `file`, in words; undefined when it is allowed. */
export function refusalOf(file: File, policy: FilePolicyView, t: TFunction): string | undefined {
  const types = Object.fromEntries(policy.extensions.map((extension) => [extension, extension]))
  switch (fileRefusal({ name: file.name, sizeBytes: file.size }, { ...policy, types })) {
    case 'name':
      return t(`${K}.badName`)
    case 'type':
      return t(`${K}.typeRefused`, { extensions: listing(policy.extensions) })
    case 'size':
      return t(`${K}.tooLarge`, { size: fileSize(policy.maxBytes) })
    default:
      return undefined
  }
}

function failureOf(err: unknown, name: string, t: TFunction): string {
  if (!(err instanceof ORPCError)) return t(`${K}.failed`)
  switch (err.status) {
    case 400:
      return t(`${K}.refused`)
    case 402:
      return t(`${K}.noSpace`)
    case 403:
      return t(`${K}.notAllowed`)
    case 409:
      return t(`${K}.taken`, { file: name })
    default:
      return t(`${K}.failed`)
  }
}

let nextKey = 0

/** Uploads files to the organization, or to a workspace, showing each one's progress. */
export function useFileUpload(workspaceId?: string) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const policy = useQuery({
    ...orpc.files.policy.queryOptions(),
    meta: { failure: t('files.notLoaded') },
  })
  const [items, setItems] = useState<UploadItem[]>([])

  const change = (key: string, patch: Partial<UploadItem>) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  const dismiss = (key: string) => setItems((current) => current.filter((item) => item.key !== key))

  async function uploadOne(file: File, key: string) {
    const refused = policy.data && refusalOf(file, policy.data, t)
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
    } finally {
      await queryClient.invalidateQueries({ queryKey: orpc.files.list.key() })
    }
  }

  function start(files: readonly File[]) {
    const added = files.map((file) => ({ file, key: `upload-${(nextKey += 1)}` }))
    setItems((current) => [
      ...current,
      ...added.map(({ file, key }) => ({ key, name: file.name, progress: 0 })),
    ])
    return Promise.all(added.map(({ file, key }) => uploadOne(file, key)))
  }

  return { items, start, dismiss, policy: policy.data }
}
