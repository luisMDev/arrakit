import { createFileRoute } from '@tanstack/react-router'

import { FilesPage } from '#/components/files/files-page'
import { requirePermission } from '#/lib/guards'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/files')({
  beforeLoad: requirePermission({ file: ['read'] }),
  head: titled('files'),
  component: FilesPage,
})
