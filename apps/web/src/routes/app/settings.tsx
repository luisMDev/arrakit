import { createFileRoute } from '@tanstack/react-router'

import { SettingsPage } from '#/components/settings/settings-page'
import { settingsSearch } from '#/components/settings/settings-sections'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/settings')({
  validateSearch: settingsSearch,
  staticData: { sidebar: 'settings' },
  head: titled('settings'),
  component: function Settings() {
    return <SettingsPage section={Route.useSearch().section} />
  },
})
