import type { BillingView } from '@arrakit/contract'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  cancelLine,
  cardLine,
  fullDay,
  invoiceLine,
  money,
  planLine,
  scheduledLine,
  seatsLine,
} from '#/components/billing/plan-copy'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import type { SectionProps } from '#/components/settings/settings-page'
import { BillingUsage, TopUpsList } from '#/components/usage/billing-usage'
import { useUsage } from '#/components/usage/use-usage'
import { reportError, toastError } from '#/lib/api-errors'
import { client, orpc } from '#/lib/orpc'

const KEY = 'settings.billingSettings'

export interface BillingSectionProps extends Partial<SectionProps> {
  openPortal?: (to: 'payment' | 'details') => Promise<{ url: string }>
  redirect?: (url: string) => void
}

function Row({
  label,
  value,
  children,
}: {
  label: string
  value: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-sm">
      <dt className="text-muted-foreground w-32 shrink-0">{label}</dt>
      <dd className="grow">{value}</dd>
      {children && <dd className="flex gap-2">{children}</dd>}
    </div>
  )
}

export function BillingSection({
  openPortal = (to) => client.billing.portal({ to }),
  redirect = (url) => window.location.assign(url),
}: BillingSectionProps = {}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const billingQuery = orpc.billing.get.queryOptions()
  const { data: billing, error } = useQuery({ ...billingQuery, retry: false })
  const usage = useUsage()
  const [cancelling, setCancelling] = useState(false)
  const [portalBusy, setPortalBusy] = useState(false)

  useEffect(() => {
    if (!error) return
    reportError('[billing] billing.get failed', error)
    toastError(t(`${KEY}.notLoaded`))
  }, [error, t])

  const replace = (next: BillingView) => queryClient.setQueryData(billingQuery.queryKey, next)

  const cancel = useMutation({
    ...orpc.billing.cancel.mutationOptions(),
    onSuccess: (next) => {
      replace(next)
      setCancelling(false)
    },
    onError: (err) => {
      reportError('[billing] cancel failed', err)
      toastError(t(`${KEY}.notCancelled`))
    },
  })
  const resume = useMutation({
    ...orpc.billing.resume.mutationOptions(),
    onSuccess: replace,
    onError: (err) => {
      reportError('[billing] resume failed', err)
      toastError(t(`${KEY}.notKept`))
    },
  })

  async function portal(to: 'payment' | 'details') {
    setPortalBusy(true)
    try {
      const { url } = await openPortal(to)
      redirect(url)
    } catch (err) {
      reportError('[billing] portal failed', err)
      toastError(t(`${KEY}.portalNotOpened`))
      setPortalBusy(false)
    }
  }

  const billed =
    !!billing &&
    billing.plan !== 'internal' &&
    (billing.plan !== 'free' || billing.card !== null || billing.invoices.length > 0)
  const cancellable = !!billing && billing.plan !== 'free' && billing.plan !== 'internal'
  const scheduled = billing ? scheduledLine(billing) : null

  const edit = (to: 'payment' | 'details') =>
    billed ? (
      <Button size="sm" variant="outline" disabled={portalBusy} onClick={() => void portal(to)}>
        {t(`${KEY}.edit`)}
      </Button>
    ) : undefined

  return (
    <section aria-labelledby="settings-billing" className="flex flex-col gap-6">
      <h2 id="settings-billing" className="text-lg font-semibold">
        {t(`${KEY}.title`)}
      </h2>

      {billing ? (
        <Card className="py-2">
          <CardContent>
            <dl className="divide-y">
              <Row label={t(`${KEY}.plan`)} value={planLine(billing)}>
                <Button asChild size="sm" variant="outline">
                  <Link to="/app/plans">{t(`${KEY}.switchPlan`)}</Link>
                </Button>
                {billing.endsOn ? (
                  <Button size="sm" disabled={resume.isPending} onClick={() => resume.mutate({})}>
                    {t(`${KEY}.keepMyPlan`)}
                  </Button>
                ) : (
                  cancellable && (
                    <Button size="sm" variant="destructive" onClick={() => setCancelling(true)}>
                      {t(`${KEY}.cancel`)}
                    </Button>
                  )
                )}
              </Row>
              {billing.renewsOn && (
                <Row label={t(`${KEY}.renewsOn`)} value={fullDay(billing.renewsOn)} />
              )}
              {billing.endsOn && <Row label={t(`${KEY}.endsOn`)} value={fullDay(billing.endsOn)} />}
              {scheduled && <Row label={t(`${KEY}.then`)} value={scheduled} />}
              {billing.nextInvoice && (
                <Row label={t(`${KEY}.nextInvoice`)} value={money(billing.nextInvoice)} />
              )}
              <Row
                label={t(`${KEY}.includes`)}
                value={
                  <span className="flex flex-wrap items-center gap-3">
                    {seatsLine(billing.seats)}
                    <Link to="/pricing" className="text-primary underline-offset-4 hover:underline">
                      {t(`${KEY}.seePricing`)}
                    </Link>
                  </span>
                }
              />
            </dl>
          </CardContent>
        </Card>
      ) : (
        !error && <Skeleton className="h-48" />
      )}

      <BillingUsage usage={usage.data} />

      {billing && (
        <Card className="py-2">
          <CardContent>
            <dl className="divide-y">
              <Row label={t(`${KEY}.payment`)} value={cardLine(billing)}>
                {edit('payment')}
              </Row>
              <Row
                label={t(`${KEY}.billingEmail`)}
                value={billing.billingEmail ?? t(`${KEY}.notSet`)}
              >
                {edit('details')}
              </Row>
              <Row label={t(`${KEY}.invoiceTo`)} value={billing.invoiceTo}>
                {edit('details')}
              </Row>
              <Row label={t(`${KEY}.taxId`)} value={billing.taxId ?? t(`${KEY}.notSet`)}>
                {edit('details')}
              </Row>
            </dl>
          </CardContent>
        </Card>
      )}

      <TopUpsList topUps={usage.data?.topUps} />

      {billing && (
        <div className="flex flex-col gap-4">
          <h3 className="text-muted-foreground text-base font-medium">{t(`${KEY}.invoices`)}</h3>
          <Card className="py-2">
            <CardContent>
              {billing.invoices.length > 0 ? (
                <ul aria-label={t(`${KEY}.invoices`)} className="divide-y">
                  {billing.invoices.map((invoice) => (
                    <li key={invoice.id} className="flex items-center gap-6 py-3 text-sm">
                      <span className="text-muted-foreground w-40 shrink-0">
                        {fullDay(invoice.issuedOn)}
                      </span>
                      <span className="grow">{invoiceLine(invoice)}</span>
                      {invoice.pdfUrl && (
                        <a
                          href={invoice.pdfUrl}
                          target="_blank"
                          rel="noopener"
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {t(`${KEY}.download`)}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground py-4 text-sm">{t(`${KEY}.noInvoices`)}</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <AlertDialog open={cancelling} onOpenChange={setCancelling}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${KEY}.cancelTitle`)}</AlertDialogTitle>
            <AlertDialogDescription>{billing && cancelLine(billing)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(`${KEY}.keepMyPlan`)}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({})}
            >
              {t(`${KEY}.cancelPlan`)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
