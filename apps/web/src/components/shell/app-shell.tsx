import { Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useCurrentUser } from '#/lib/current-user'

import { AppMenu } from './app-menu'
import { OrgSwitcher } from './org-switcher'

/** The signed-in part: the organization switcher and the app menu on the header's row. */
export function AppShell() {
  const { t } = useTranslation()
  const { user } = useCurrentUser()
  // Signing out or switching organizations drops the person for a moment: nothing renders then.
  if (!user?.organization) return null
  return (
    <>
      <nav
        aria-label={t('shell.account')}
        className="absolute top-0 right-4 z-20 flex h-14 items-center gap-4 [view-transition-name:app-bar] sm:right-6"
      >
        <OrgSwitcher />
        <AppMenu />
      </nav>
      <Outlet />
    </>
  )
}
