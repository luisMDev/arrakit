import { type ErrorComponentProps, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import { reportError } from '#/lib/api-errors'

import { RootFrame } from './root-layout'
import { reloadOnStaleChunk } from './stale-chunk'

/** A screen that failed to load: a stale lazy chunk reloads the target once, anything else says so. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation()
  const router = useRouter()

  useEffect(() => {
    if (!reloadOnStaleChunk(error)) reportError('[router] a screen failed to load', error)
  }, [error])

  return (
    <RootFrame>
      <main className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 p-6">
        <h1 className="text-2xl font-semibold">{t('unavailable.unreachableTitle')}</h1>
        <p className="text-muted-foreground">{t('unavailable.unreachableBody')}</p>
        <Button
          onClick={() => {
            reset()
            void router.invalidate()
          }}
        >
          {t('unavailable.tryAgain')}
        </Button>
      </main>
    </RootFrame>
  )
}
