import { createFileRoute } from '@tanstack/react-router'

import { SettingsPage, settingsSearch } from '#/components/settings/settings-page'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/settings')({
  validateSearch: settingsSearch,
  head: titled('settings'),
  component: function Settings() {
    return <SettingsPage section={Route.useSearch().section} />
  },
})
