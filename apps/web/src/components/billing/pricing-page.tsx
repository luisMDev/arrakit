import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { BillingCycle } from '@arrakit/plans'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { APP_NAME, SITE_URL } from '#/config'
import { orpc } from '#/lib/orpc'
import { useFailureToast } from '#/lib/use-failure-toast'

import { BillingCycleSwitch } from './billing-cycle-switch'
import { FeatureList, PlanCard } from './plan-card'
import { leastYearlySaving, planLabel, pricingCopy } from './plan-copy'

export function PricingPage() {
  const { t } = useTranslation()
  const [cycle, setCycle] = useState<BillingCycle>('yearly')
  const { data: offers, error } = useQuery(orpc.plans.list.queryOptions({ staleTime: Infinity }))

  useFailureToast(error, '[pricing] plans.list failed', t('pricing.loadFailed'))

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="font-semibold">{APP_NAME}</span>
        <Button asChild variant="ghost">
          <Link to="/signin">{t('pricing.signIn')}</Link>
        </Button>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-8 px-6 py-12">
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">
            {t('pricing.titleLead')} <span className="text-primary">{t('pricing.titleRest')}</span>
          </h1>
          <p className="text-muted-foreground">{t('pricing.subtitle')}</p>
        </div>
        <BillingCycleSwitch
          cycle={cycle}
          saving={offers ? leastYearlySaving(offers) : null}
          onChange={setCycle}
        />
        <div className="grid w-full gap-6 md:grid-cols-3">
          {offers
            ? offers.map((offer) => {
                const copy = pricingCopy(offer)
                const paid = offer.monthly.amount > 0
                return (
                  <PlanCard
                    key={offer.plan}
                    offer={offer}
                    cycle={cycle}
                    highlighted={offer.plan === 'team'}
                    priceNote={paid ? t(`pricing.billed.${cycle}`) : t('pricing.noCardNeeded')}
                    action={
                      <Button
                        asChild
                        className="w-full"
                        variant={offer.plan === 'team' ? 'default' : 'outline'}
                      >
                        {paid ? (
                          <Link to="/signup" search={{ plan: offer.plan, cycle }}>
                            {t('pricing.getPlan', { plan: planLabel(offer.plan) })}
                          </Link>
                        ) : (
                          <Link to="/signup">{t('pricing.startFree')}</Link>
                        )}
                      </Button>
                    }
                  >
                    <div className="flex flex-col gap-4">
                      <FeatureList items={copy.usage} />
                      {copy.lead && <p className="text-sm font-medium">{copy.lead}</p>}
                      <FeatureList items={copy.features} />
                    </div>
                  </PlanCard>
                )
              })
            : [0, 1, 2].map((key) => <Skeleton key={key} className="h-96 w-full" />)}
        </div>
      </main>
      <footer className="text-muted-foreground border-t px-6 py-4 text-center text-sm">
        <a href={SITE_URL} className="hover:underline">
          {t('pricing.home')}
        </a>
      </footer>
    </div>
  )
}
