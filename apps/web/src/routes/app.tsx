import { createFileRoute } from '@tanstack/react-router'

import { AppShell } from '#/components/shell/app-shell'
import { requireUser } from '#/lib/guards/require-user'

export const Route = createFileRoute('/app')({
  beforeLoad: requireUser,
  component: AppShell,
})
