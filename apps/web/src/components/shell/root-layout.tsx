import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { type ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { APP_NAME, SITE_URL } from '#/config'
import { initialOf } from '#/lib/current-user'
import { cn } from '#/lib/utils'

import { reloadOnStaleChunk } from './stale-chunk'

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
        {initialOf(APP_NAME)}
      </span>
      {APP_NAME}
    </span>
  )
}

export function RootFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const inApp = isInApp(pathname)
  return (
    <div className="relative flex min-h-svh flex-col">
      <header
        className={cn(
          'flex h-14 items-center border-b px-4 [view-transition-name:site-header] sm:px-6',
          inApp && 'pl-13 sm:pl-14',
        )}
      >
        {inApp ? (
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

/** A lazy chunk that Vite failed to preload after a deploy; cancelled so Vite does not rethrow it. */
function useStaleChunkRecovery() {
  useEffect(() => {
    const listener = (event: Event) => {
      if (reloadOnStaleChunk((event as Event & { payload?: unknown }).payload)) {
        event.preventDefault()
      }
    }
    window.addEventListener('vite:preloadError', listener)
    return () => window.removeEventListener('vite:preloadError', listener)
  }, [])
}

export function RootLayout() {
  useStaleChunkRecovery()
  return (
    <RootFrame>
      <Outlet />
    </RootFrame>
  )
}
