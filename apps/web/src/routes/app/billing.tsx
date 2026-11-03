import { createFileRoute, redirect } from '@tanstack/react-router'

import { settingsSearch } from '#/components/settings/settings-sections'

export const Route = createFileRoute('/app/billing')({
  validateSearch: settingsSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/app/settings', search: { ...search, section: 'billing' } })
  },
})
