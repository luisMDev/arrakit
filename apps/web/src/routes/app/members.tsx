import { createFileRoute } from '@tanstack/react-router'

import { SettingsPage } from '#/components/settings/settings-page'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/members')({
  head: titled('settings'),
  component: () => <SettingsPage section="members" />,
})
