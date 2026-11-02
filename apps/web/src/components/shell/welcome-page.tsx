import { Link } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { planLabel } from '#/components/billing/plan-copy'
import { Button } from '#/components/ui/button'
import { useCurrentUser } from '#/lib/current-user'

/** After a paid Checkout: the organization is on a paid plan, as the API reports it. */
export function WelcomePage() {
  const { t } = useTranslation()
  const { user } = useCurrentUser()
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 p-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="size-7" aria-hidden="true" />
      </span>
      <h1 className="text-3xl font-semibold tracking-tight">
        {t('welcome.titleLead')}{' '}
        {t('welcome.titleRest', { plan: user?.plan ? planLabel(user.plan) : '' })}
      </h1>
      <p className="text-muted-foreground">{t('welcome.body')}</p>
      <Button asChild size="lg">
        <Link to="/app">{t('welcome.goHome')}</Link>
      </Button>
      <p className="text-sm text-muted-foreground">
        {t('welcome.receiptSent')}{' '}
        <Link
          to="/app/settings"
          search={{ section: 'billing' }}
          className="underline underline-offset-4"
        >
          {t('welcome.settings')}
        </Link>
        {t('welcome.receiptEnd')}
      </p>
    </main>
  )
}
