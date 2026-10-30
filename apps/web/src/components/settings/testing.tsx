import { useSearch } from '@tanstack/react-router'

import { SettingsPage } from './settings-page'

/** Settings reading its section from the URL, as the `/app/settings` route does. */
export function RoutedSettings() {
  return <SettingsPage section={useSearch({ strict: false }).section} />
}
