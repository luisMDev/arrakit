import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import { SITE_URL } from '#/config'

const SAFE_NEXT = /^\/(?:app|signup|profile)(?:[/?#]|$)/

/** Where Try again goes: an in-app path, never another site (open redirect). */
export function safeNext(next: string | undefined): string {
  return next && SAFE_NEXT.test(next) ? next : '/app'
}

/** The API failed: refused this account (`forbidden`) or could not be reached. */
export function UnavailablePage({ reason, next }: { reason?: 'forbidden'; next?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  if (reason === 'forbidden') {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('unavailable.forbiddenTitle')}</h1>
        <p className="text-muted-foreground">{t('unavailable.forbiddenBody')}</p>
        <Button asChild variant="ghost">
          <a href={SITE_URL}>{t('unavailable.home')}</a>
        </Button>
      </main>
    )
  }

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
