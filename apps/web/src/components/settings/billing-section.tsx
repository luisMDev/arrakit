import type { BillingView } from '@arrakit/contract'
import { isPaidPlan } from '@arrakit/plans'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Receipt } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  cancelLine,
  cardLine,
  invoiceLine,
  planLine,
  scheduledLine,
  seatsLine,
} from '#/components/billing/plan-copy'
import { EmptyState } from '#/components/shell/empty-state'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { BillingUsage, TopUpsList } from '#/components/usage/billing-usage'
import { useUsage } from '#/components/usage/usage-cards'
import { useCurrentUser } from '#/lib/current-user'
import { fullDay, money } from '#/lib/format'
import { leave } from '#/lib/leave'
import { client, orpc } from '#/lib/orpc'
import { useApiMutation } from '#/lib/use-api-mutation'

import { ConfirmDialog } from './confirm-dialog'
import { SettingRow, SettingsCard, SettingsHeading, SettingsSectionLayout } from './settings-ui'

const KEY = 'settings.billingSettings'

export function BillingSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const billingQuery = orpc.billing.get.queryOptions({ meta: { failure: t(`${KEY}.notLoaded`) } })
  const { data: billing, error } = useQuery(billingQuery)
  const usage = useUsage()
  const { can, managesBilling } = useCurrentUser()
  const [cancelling, setCancelling] = useState(false)

  const replace = (next: BillingView) => queryClient.setQueryData(billingQuery.queryKey, next)

  const cancel = useApiMutation({
    ...orpc.billing.cancel.mutationOptions(),
    onSuccess: (next) => {
      replace(next)
      setCancelling(false)
    },
    meta: { failure: t(`${KEY}.notCancelled`) },
  })
  const resume = useApiMutation({
    ...orpc.billing.resume.mutationOptions(),
    onSuccess: replace,
    meta: { failure: t(`${KEY}.notKept`) },
  })

  const portal = useApiMutation({
    mutationFn: (to: 'payment' | 'details') => client.billing.portal({ to }),
    onSuccess: ({ url }) => leave(url),
    meta: { failure: t(`${KEY}.portalNotOpened`) },
  })

  const billed =
    !!billing &&
    billing.plan !== 'internal' &&
    (billing.plan !== 'free' || billing.card !== null || billing.invoices.length > 0)
  const scheduled = billing ? scheduledLine(billing) : null

  const edit = (to: 'payment' | 'details') =>
    billed && managesBilling ? (
      <Button
        size="sm"
        variant="outline"
        disabled={portal.busy}
        onClick={() => void portal.run(to)}
      >
        {t(`${KEY}.edit`)}
      </Button>
    ) : undefined

  return (
    <SettingsSectionLayout id="billing" title={t(`${KEY}.title`)}>
      {billing ? (
        <SettingsCard>
          <SettingRow
            label={t(`${KEY}.plan`)}
            action={
              managesBilling && (
                <span className="flex gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/app/plans">{t(`${KEY}.switchPlan`)}</Link>
                  </Button>
                  {billing.endsOn ? (
                    <Button
                      size="sm"
                      disabled={resume.isPending}
                      onClick={() => void resume.run({})}
                    >
                      {t(`${KEY}.keepMyPlan`)}
                    </Button>
                  ) : (
                    isPaidPlan(billing.plan) && (
                      <Button size="sm" variant="destructive" onClick={() => setCancelling(true)}>
                        {t(`${KEY}.cancel`)}
                      </Button>
                    )
                  )}
                </span>
              )
            }
          >
            {planLine(billing)}
          </SettingRow>
          {billing.renewsOn && (
            <SettingRow label={t(`${KEY}.renewsOn`)}>{fullDay(billing.renewsOn)}</SettingRow>
          )}
          {billing.endsOn && (
            <SettingRow label={t(`${KEY}.endsOn`)}>{fullDay(billing.endsOn)}</SettingRow>
          )}
          {scheduled && <SettingRow label={t(`${KEY}.then`)}>{scheduled}</SettingRow>}
          {billing.nextInvoice && (
            <SettingRow label={t(`${KEY}.nextInvoice`)}>{money(billing.nextInvoice)}</SettingRow>
          )}
          <SettingRow label={t(`${KEY}.includes`)}>
            <span className="flex flex-wrap items-center gap-3">
              {seatsLine(billing.seats)}
              <Link to="/pricing" className="text-primary underline-offset-4 hover:underline">
                {t(`${KEY}.seePricing`)}
              </Link>
            </span>
          </SettingRow>
        </SettingsCard>
      ) : (
        !error && <Skeleton className="h-48" />
      )}

      {can({ usage: ['read'] }) && <BillingUsage usage={usage.data} />}

      {billing && (
        <SettingsCard>
          <SettingRow label={t(`${KEY}.payment`)} action={edit('payment')}>
            {cardLine(billing)}
          </SettingRow>
          <SettingRow label={t(`${KEY}.billingEmail`)} action={edit('details')}>
            {billing.billingEmail ?? t(`${KEY}.notSet`)}
          </SettingRow>
          <SettingRow label={t(`${KEY}.invoiceTo`)} action={edit('details')}>
            {billing.invoiceTo}
          </SettingRow>
          <SettingRow label={t(`${KEY}.taxId`)} action={edit('details')}>
            {billing.taxId ?? t(`${KEY}.notSet`)}
          </SettingRow>
        </SettingsCard>
      )}

      <TopUpsList topUps={usage.data?.topUps} />

      {billing && (
        <div className="flex flex-col gap-2">
          <SettingsHeading>{t(`${KEY}.invoices`)}</SettingsHeading>
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
                <EmptyState icon={Receipt} title={t(`${KEY}.noInvoices`)} />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t(`${KEY}.cancelTitle`)}
        description={billing ? cancelLine(billing) : ''}
        cancelLabel={t(`${KEY}.keepMyPlan`)}
        confirmLabel={t(`${KEY}.cancelPlan`)}
        pending={cancel.isPending}
        onConfirm={() => void cancel.run({})}
      />
    </SettingsSectionLayout>
  )
}
