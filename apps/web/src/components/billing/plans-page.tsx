import type { ChangePreview, PaidChoice, PlanOfferView } from '@arrakit/contract'
import type { BillingCycle, Plan } from '@arrakit/plans'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Skeleton } from '#/components/ui/skeleton'
import { apiFailed, paymentRefusal, refusalMessage } from '#/lib/api-errors'
import { useCurrentUser } from '#/lib/current-user'
import { orpc } from '#/lib/orpc'
import { useFailureToast } from '#/lib/use-failure-toast'

import { BillingCycleSwitch } from './billing-cycle-switch'
import { isPaying, plansAbove } from './plan-access'
import { FeatureList, PlanCard } from './plan-card'
import {
  leastYearlySaving,
  money,
  planFeatures,
  planLabel,
  seatsLine,
  switchLines,
  twelveMonths,
  yearlySaving,
} from './plan-copy'

type PaidOffer = PlanOfferView & { plan: PaidChoice['plan'] }

interface PendingSwitch {
  choice: PaidChoice
  preview: ChangePreview
}

export function PlansPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, isAdmin, reload } = useCurrentUser()
  const current: Plan | null = user?.plan ?? null
  const [chosenCycle, setCycle] = useState<BillingCycle | null>(null)
  const [annualOffer, setAnnualOffer] = useState<PaidOffer | null>(null)
  const [pending, setPending] = useState<PendingSwitch | null>(null)

  const offers = useQuery(orpc.plans.list.queryOptions())
  const wantsBilling = isAdmin && isPaying(current)
  const billingQuery = orpc.billing.get.queryOptions()
  const billing = useQuery({ ...billingQuery, enabled: wantsBilling })
  // Only a known cycle on a paid plan counts as paying (as saas-base): otherwise no switch is offered.
  const paying =
    wantsBilling && billing.data?.cycle && isPaying(billing.data.plan)
      ? { ...billing.data, cycle: billing.data.cycle }
      : null
  const cycle: BillingCycle = chosenCycle ?? paying?.cycle ?? 'yearly'

  useFailureToast(offers.error, '[plans] plans.list failed', t('plans.loadFailed'))
  useFailureToast(
    billing.error,
    '[plans] billing.get failed',
    t('plans.billingLoadFailed'),
    refusalMessage,
  )

  const preview = useMutation({
    ...orpc.billing.previewChange.mutationOptions(),
    onSuccess: (result, choice) => setPending({ choice, preview: result }),
    onError: (err) => apiFailed('[plans] preview failed', err, t('plans.priceFailed')),
  })
  const change = useMutation({
    ...orpc.billing.change.mutationOptions(),
    onSuccess: async (next) => {
      queryClient.setQueryData(billingQuery.queryKey, next)
      setPending(null)
      await reload()
      await navigate({ to: '/app/billing' })
    },
    onError: (err) =>
      apiFailed('[plans] switch failed', err, t('plans.switchFailed'), paymentRefusal),
  })

  const goToCheckout = (choice: PaidChoice) =>
    navigate({ to: '/app/checkout', search: { plan: choice.plan, cycle: choice.cycle } })

  const select = (offer: PaidOffer) => {
    if (cycle === 'yearly') void goToCheckout({ plan: offer.plan, cycle })
    else setAnnualOffer(offer)
  }

  const above = current ? plansAbove(current) : []
  const busy = preview.isPending || change.isPending

  function actionFor(offer: PlanOfferView, isCurrent: boolean) {
    if (isCurrent) {
      return (
        <Button className="w-full" variant="outline" disabled>
          {t('plans.currentPlan')}
        </Button>
      )
    }
    if (!isAdmin || offer.plan === 'free' || offer.plan === 'internal') return null
    const paid = offer as PaidOffer
    if (current === 'free' && above.includes(offer.plan)) {
      return (
        <Button
          className="w-full"
          variant={offer.plan === 'team' ? 'default' : 'outline'}
          onClick={() => select(paid)}
        >
          {t('plans.select', { plan: planLabel(offer.plan) })}
        </Button>
      )
    }
    if (paying) {
      return (
        <Button
          className="w-full"
          variant="outline"
          disabled={busy}
          onClick={() => preview.mutate({ plan: paid.plan, cycle })}
        >
          {t('plans.switchTo', { plan: planLabel(offer.plan) })}
        </Button>
      )
    }
    return null
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t('plans.titleLead')} <span className="text-primary">{t('plans.titleRest')}</span>
        </h1>
        <p className="text-muted-foreground">{t('plans.subtitle')}</p>
      </div>
      <BillingCycleSwitch
        cycle={cycle}
        saving={offers.data ? leastYearlySaving(offers.data) : null}
        onChange={setCycle}
      />
      <div className="grid w-full gap-6 md:grid-cols-3">
        {offers.data
          ? offers.data.map((offer) => {
              const paid = offer.monthly.amount > 0
              const isCurrent = offer.plan === current && (!paying || paying.cycle === cycle)
              return (
                <PlanCard
                  key={offer.plan}
                  offer={offer}
                  cycle={cycle}
                  highlighted={offer.plan === 'team'}
                  badge={offer.plan === 'team' ? t('plans.recommended') : undefined}
                  priceNote={
                    paid
                      ? t('plans.perMonthBilled', { billed: t(`pricing.billedLower.${cycle}`) })
                      : null
                  }
                  action={actionFor(offer, isCurrent)}
                >
                  <FeatureList items={[seatsLine(offer.seats), ...planFeatures(offer.plan)]} />
                </PlanCard>
              )
            })
          : [0, 1, 2].map((key) => <Skeleton key={key} className="h-80 w-full" />)}
      </div>
      {user && !isAdmin && <p className="text-muted-foreground text-sm">{t('plans.onlyAdmin')}</p>}
      <nav className="flex gap-4 text-sm">
        <Button asChild variant="link">
          <Link to="/app">{t('plans.notNow')}</Link>
        </Button>
        <Button asChild variant="link">
          <Link to="/pricing">{t('plans.compareAll')}</Link>
        </Button>
      </nav>

      <Dialog open={annualOffer !== null} onOpenChange={(open) => !open && setAnnualOffer(null)}>
        <DialogContent>
          {annualOffer && (
            <>
              <DialogHeader>
                <DialogTitle>{t('plans.annualModal')}</DialogTitle>
                <DialogDescription>
                  {t('plans.annualTitle', { plan: planLabel(annualOffer.plan) })}{' '}
                  <Badge variant="secondary">
                    {t('plans.save', { saving: yearlySaving(annualOffer) })}
                  </Badge>
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm">
                {t('plans.compared', {
                  yearly: money(annualOffer.yearly),
                  monthly: money(twelveMonths(annualOffer)),
                })}
              </p>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => void goToCheckout({ plan: annualOffer.plan, cycle: 'monthly' })}
                >
                  {t('plans.continueMonthly')}
                </Button>
                <Button
                  onClick={() => void goToCheckout({ plan: annualOffer.plan, cycle: 'yearly' })}
                >
                  {t('plans.continueYearly')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          {pending && current && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t(`plans.switchTitle.${pending.choice.cycle}`, {
                    plan: planLabel(pending.choice.plan),
                  })}
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-2 text-sm">
                {switchLines(current, pending.choice, pending.preview).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)}>
                  {t('plans.notNow')}
                </Button>
                <Button disabled={change.isPending} onClick={() => change.mutate(pending.choice)}>
                  {t('plans.switchTo', { plan: planLabel(pending.choice.plan) })}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  )
}
