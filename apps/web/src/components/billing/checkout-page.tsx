import type { PaidChoice } from '@arrakit/contract'
import { soldOffers } from '@arrakit/plans'
import { type StripeEmbeddedCheckout, loadStripe } from '@stripe/stripe-js'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '#/components/ui/card'
import { Separator } from '#/components/ui/separator'
import { Spinner } from '#/components/ui/spinner'
import { APP_NAME } from '#/config'
import { apiMessage } from '#/lib/api-errors'
import { money } from '#/lib/format'
import { client } from '#/lib/orpc'

import { planLabel } from './plan-copy'

const OFFERS = soldOffers()

let opened: StripeEmbeddedCheckout | null = null

/** Stripe allows one Embedded Checkout at a time: the one opened before is destroyed first. */
async function openCheckout(choice: PaidChoice): Promise<StripeEmbeddedCheckout> {
  const { clientSecret, publishableKey } = await client.billing.checkout(choice)
  const stripe = await loadStripe(publishableKey)
  if (!stripe) throw new Error('Stripe.js did not load')
  opened?.destroy()
  opened = await stripe.createEmbeddedCheckoutPage({ clientSecret })
  return opened
}

function useEmbeddedCheckout(choice: PaidChoice) {
  const mountRef = useRef<HTMLDivElement>(null)
  const checkout = useQuery({
    queryKey: ['checkout', choice.plan, choice.cycle],
    queryFn: () => openCheckout(choice),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  })
  const embedded = checkout.data
  useEffect(() => {
    if (!embedded || !mountRef.current) return
    embedded.mount(mountRef.current)
    return () => embedded.unmount()
  }, [embedded])
  return { mountRef, ...checkout }
}

export function CheckoutPage({ choice }: { choice: PaidChoice }) {
  const { t } = useTranslation()
  const { mountRef, isPending, error } = useEmbeddedCheckout(choice)
  const failure = error ? (apiMessage(error) ?? t('checkout.openFailed')) : null
  const offer = OFFERS.find((o) => o.plan === choice.plan)
  const total = offer ? money(choice.cycle === 'yearly' ? offer.yearly : offer.monthly) : null
  const product = `${APP_NAME} ${planLabel(choice.plan)}`

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-10 md:grid-cols-2">
      <section aria-label={t('checkout.orderSummary')} className="flex flex-col gap-6">
        <Button asChild variant="ghost" className="self-start">
          <Link to="/app/plans">
            <ArrowLeft aria-hidden />
            {t('checkout.back')}
          </Link>
        </Button>
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground">{t('checkout.subscribeTo', { product })}</p>
          <p className="text-3xl font-semibold">
            {total}{' '}
            <span className="text-muted-foreground text-base font-normal">
              {t(`checkout.per.${choice.cycle}`)}
            </span>
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between gap-4">
              <div>
                <p className="font-medium">{product}</p>
                <p className="text-muted-foreground">{t(`checkout.terms.${choice.cycle}`)}</p>
              </div>
              <span>{total}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span>{t('checkout.subtotal')}</span>
              <span>{total}</span>
            </div>
            <div className="text-muted-foreground flex justify-between">
              <span>{t('checkout.tax')}</span>
              <span>{t('checkout.taxFromAddress')}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-medium">
              <span>{t('checkout.totalDueToday')}</span>
              <span>{total}</span>
            </div>
          </CardContent>
        </Card>
      </section>
      <Card>
        <CardHeader>
          <CardTitle>{t('checkout.payment')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isPending && (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Spinner />
              {t('checkout.opening')}
            </p>
          )}
          {failure && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          )}
          <div ref={mountRef} data-stripe-checkout />
        </CardContent>
        <CardFooter className="text-muted-foreground text-xs">
          {t('checkout.cancelAnytime')}
        </CardFooter>
      </Card>
    </main>
  )
}
