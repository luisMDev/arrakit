import type { PaidChoice } from '@arrakit/contract'
import { loadStripe } from '@stripe/stripe-js'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '#/components/ui/card'
import { Separator } from '#/components/ui/separator'
import { Spinner } from '#/components/ui/spinner'
import { APP_NAME } from '#/config'
import { paymentRefusal, reportError } from '#/lib/api-errors'
import { client, orpc } from '#/lib/orpc'
import { useFailureToast } from '#/lib/use-failure-toast'

import { money, planLabel } from './plan-copy'

type Mounted = { destroy(): void }

function useEmbeddedCheckout({ plan, cycle }: PaidChoice) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{
    opening: boolean
    failed: boolean
    refusal: string | null
  }>({ opening: true, failed: false, refusal: null })

  useEffect(() => {
    let cancelled = false
    let checkout: Mounted | null = null
    void (async () => {
      try {
        const { clientSecret, publishableKey } = await client.billing.checkout({ plan, cycle })
        const stripe = await loadStripe(publishableKey)
        if (!stripe) throw new Error('Stripe.js did not load')
        const embedded = await stripe.createEmbeddedCheckoutPage({ clientSecret })
        if (cancelled) {
          embedded.destroy()
          return
        }
        checkout = embedded
        if (mountRef.current) embedded.mount(mountRef.current)
        setState({ opening: false, failed: false, refusal: null })
      } catch (err) {
        if (cancelled) return
        reportError('[checkout] could not open Embedded Checkout', err)
        setState({ opening: false, failed: true, refusal: paymentRefusal(err) })
      }
    })()
    return () => {
      cancelled = true
      checkout?.destroy()
    }
  }, [plan, cycle])

  return { mountRef, ...state }
}

export function CheckoutPage({ choice }: { choice: PaidChoice }) {
  const { t } = useTranslation()
  const offers = useQuery(orpc.plans.list.queryOptions())
  const { mountRef, opening, failed, refusal } = useEmbeddedCheckout(choice)
  const error = failed ? (refusal ?? t('checkout.openFailed')) : null
  const offer = offers.data?.find((o) => o.plan === choice.plan)
  const total = offer ? money(choice.cycle === 'yearly' ? offer.yearly : offer.monthly) : null
  const product = `${APP_NAME} ${planLabel(choice.plan)}`

  useFailureToast(offers.error, '[checkout] plans.list failed', t('checkout.loadFailed'))

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
          {opening && (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Spinner />
              {t('checkout.opening')}
            </p>
          )}
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
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
