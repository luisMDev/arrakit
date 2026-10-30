import { Link, Outlet, useLocation, useRouter } from '@tanstack/react-router'
import { type ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { APP_NAME, SITE_URL } from '#/config'

import { onPreloadError, type PreloadErrorEvent } from './stale-chunk'

export function isInApp(pathname: string): boolean {
  return pathname.split('/')[1] === 'app'
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2 font-semibold">
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground"
      >
        {APP_NAME.charAt(0).toUpperCase()}
      </span>
      {APP_NAME}
    </span>
  )
}

export function RootFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  return (
    <div className="relative flex min-h-svh flex-col">
      <header className="flex h-14 items-center border-b px-4 [view-transition-name:site-header] sm:px-6">
        {isInApp(pathname) ? (
          <Link to="/app" aria-label={t('app.homeLabel')}>
            <Wordmark />
          </Link>
        ) : (
          <a href={SITE_URL} aria-label={t('app.homeLabel')}>
            <Wordmark />
          </a>
        )}
      </header>
      {children}
    </div>
  )
}

/**
 * A lazy chunk that Vite failed to preload after a deploy: reload the screen being opened once
 * (the router's latest location is the navigation's target).
 */
function useStaleChunkRecovery() {
  const router = useRouter()
  useEffect(() => {
    const listener = (event: Event) =>
      onPreloadError(event as PreloadErrorEvent, router.latestLocation.href, window)
    window.addEventListener('vite:preloadError', listener)
    return () => window.removeEventListener('vite:preloadError', listener)
  }, [router])
}

export function RootLayout() {
  useStaleChunkRecovery()
  return (
    <RootFrame>
      <Outlet />
    </RootFrame>
  )
}
