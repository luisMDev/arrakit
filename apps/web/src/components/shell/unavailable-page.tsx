import { type ErrorComponentProps, useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import { searchText } from '#/lib/search-params'

import { RootFrame } from './root-layout'
import { reloadOnStaleChunk } from './stale-chunk'

const SAFE_NEXT = /^\/(?:app|signup|signin|profile)(?:[/?#]|$)/

/** Where Try again goes: an in-app path, never another site (open redirect). */
export function safeNext(next: string | undefined): string {
  return next && SAFE_NEXT.test(next) ? next : '/app'
}

export const unavailableSearch = z.object({ next: searchText })

/** The API could not be reached or failed; Try again goes back to `next`, or runs `onRetry`. */
export function UnavailablePage({ next, onRetry }: { next?: string; onRetry?: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('unavailable.unreachableTitle')}</h1>
      <p className="text-muted-foreground">{t('unavailable.unreachableBody')}</p>
      <Button onClick={onRetry ?? (() => void navigate({ href: safeNext(next) }))}>
        {t('unavailable.tryAgain')}
      </Button>
    </main>
  )
}

/** A screen that failed to load: a stale lazy chunk reloads the target once, anything else says so. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()

  useEffect(() => {
    if (!reloadOnStaleChunk(error)) console.error('[router] a screen failed to load', error)
  }, [error])

  return (
    <RootFrame>
      <UnavailablePage
        onRetry={() => {
          reset()
          void router.invalidate()
        }}
      />
    </RootFrame>
  )
}
