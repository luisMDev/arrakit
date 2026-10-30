import type { UsageView } from '@arrakit/contract'
import { Coins } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '#/components/shell/empty-state'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { fullDay } from '#/lib/format'

import { AddCreditsDialog, type AddCreditsDialogProps } from './add-credits-dialog'
import { UsageCards } from './usage-cards'
import { topUpLine } from './usage-copy'

const KEY = 'settings.billingSettings.usage'

function paidFromUrl(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('top_up') === 'paid'
}

interface BillingUsageProps extends Pick<AddCreditsDialogProps, 'startTopUp' | 'redirect'> {
  usage: UsageView | undefined
  /** Checkout came back paid (`?top_up=paid`); read from the URL when omitted. */
  topUpPaid?: boolean
}

/** Settings > Billing "Usage": what is left, and Add credits (admins only). */
export function BillingUsage({ usage, topUpPaid, startTopUp, redirect }: BillingUsageProps) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [paidInUrl] = useState(paidFromUrl)
  const paid = topUpPaid ?? paidInUrl

  return (
    <section aria-label={t(`${KEY}.title`)} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-muted-foreground text-base font-medium">{t(`${KEY}.title`)}</h3>
        <Button type="button" size="sm" onClick={() => setAdding(true)}>
          {t(`${KEY}.addCredits`)}
        </Button>
      </div>
      {paid && (
        <p role="status" className="text-sm text-green-600 dark:text-green-400">
          {t(`${KEY}.topUpPaid`)}
        </p>
      )}
      {usage && <UsageCards metrics={usage.metrics} />}
      <AddCreditsDialog
        open={adding}
        onOpenChange={setAdding}
        startTopUp={startTopUp}
        redirect={redirect}
      />
    </section>
  )
}

/** Settings > Billing "Top-ups": newest first. */
export function TopUpsList({ topUps }: { topUps: UsageView['topUps'] | undefined }) {
  const { t } = useTranslation()
  if (!topUps) return null
  return (
    <div data-top-ups className="flex flex-col gap-4">
      <h3 className="text-muted-foreground text-base font-medium">{t(`${KEY}.topUps`)}</h3>
      <Card className="py-2">
        <CardContent>
          {topUps.length > 0 ? (
            <ul className="divide-y">
              {topUps.map((topUp, index) => (
                <li key={index} className="flex items-center gap-6 py-3 text-sm">
                  <span className="text-muted-foreground w-40 shrink-0">
                    {fullDay(topUp.paidOn)}
                  </span>
                  <span className="grow">{topUpLine(topUp)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Coins} title={t(`${KEY}.noTopUps`)} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
