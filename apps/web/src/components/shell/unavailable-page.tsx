import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'

const SAFE_NEXT = /^\/(?:app|signup|signin|profile)(?:[/?#]|$)/

/** Where Try again goes: an in-app path, never another site (open redirect). */
export function safeNext(next: string | undefined): string {
  return next && SAFE_NEXT.test(next) ? next : '/app'
}

export const unavailableSearch = (search: Record<string, unknown>): { next?: string } =>
  typeof search.next === 'string' ? { next: search.next } : {}

/** The API could not be reached or failed; Try again goes back to `next`. */
export function UnavailablePage({ next }: { next?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('unavailable.unreachableTitle')}</h1>
      <p className="text-muted-foreground">{t('unavailable.unreachableBody')}</p>
      <Button onClick={() => void navigate({ href: safeNext(next) })}>
        {t('unavailable.tryAgain')}
      </Button>
    </main>
  )
}
