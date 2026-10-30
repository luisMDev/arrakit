import { createFileRoute } from '@tanstack/react-router'

import { NotFoundPage } from '#/components/shell/not-found-page'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/$')({
  head: titled('notFound'),
  component: NotFoundPage,
})
