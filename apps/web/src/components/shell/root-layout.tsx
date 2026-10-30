import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { APP_NAME, SITE_URL } from '#/config'

export function isInApp(pathname: string): boolean {
  return pathname.split('/')[1] === 'app'
}

export function RootLayout() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const wordmark = <span className="font-semibold">{APP_NAME}</span>
  return (
    <>
      <header className="flex h-14 items-center border-b px-4">
        {isInApp(pathname) ? (
          <Link to="/app" aria-label={t('app.homeLabel')}>
            {wordmark}
          </Link>
        ) : (
          <a href={SITE_URL} aria-label={t('app.homeLabel')}>
            {wordmark}
          </a>
        )}
      </header>
      <Outlet />
    </>
  )
}
