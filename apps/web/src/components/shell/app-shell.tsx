import { Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useCurrentUser } from '#/lib/current-user'

import { AppMenu } from './app-menu'

/** The signed-in part: the organization's plan and the app menu on the header's row. */
export function AppShell() {
  const { t } = useTranslation()
  const { user, planLabel } = useCurrentUser()
  return (
    <>
      {user?.organization ? (
        <nav
          aria-label={t('shell.account')}
          className="absolute top-0 right-4 z-20 flex h-14 items-center gap-4 sm:right-6"
        >
          <span className="hidden text-sm text-muted-foreground lg:inline">
            {t('shell.usage', { organization: user.organization.name, plan: planLabel })}
          </span>
          <AppMenu />
        </nav>
      ) : null}
      <Outlet />
    </>
  )
}
