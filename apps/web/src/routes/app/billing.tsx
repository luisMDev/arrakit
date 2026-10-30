import { createFileRoute } from '@tanstack/react-router'

import { SettingsPage } from '#/components/settings/settings-page'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/billing')({
  validateSearch: (search: Record<string, unknown>): { top_up?: string } =>
    typeof search.top_up === 'string' ? { top_up: search.top_up } : {},
  head: titled('settings'),
  component: () => <SettingsPage section="billing" />,
})
