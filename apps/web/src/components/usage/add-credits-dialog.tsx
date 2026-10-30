import { CURRENCY, METRIC_KEYS, TOP_UP, isTopUpAmount, metricAmounts } from '@arrakit/plans'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { money } from '#/lib/format'
import { client } from '#/lib/orpc'
import { useApiMutation } from '#/lib/use-api-mutation'
import { cn } from '#/lib/utils'

import { amountsLine } from './usage-copy'

const KEY = 'settings.billingSettings.usage'
const DEFAULT_DOLLARS = String(2_000 / 100)

function toCents(value: string): number | null {
  return value.trim() === '' ? null : Math.round(Number(value) * 100)
}

const topUpCents = z.string().transform(toCents).refine(isTopUpAmount)
const topUpForm = z.object({ amount: topUpCents })

export interface AddCreditsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Starts Checkout and resolves to its URL; defaults to `billing.topUp`. */
  startTopUp?: (cents: number) => Promise<{ url: string }>
  /** Leaves for Checkout; defaults to `window.location.assign`. */
  redirect?: (url: string) => void
}

export function AddCreditsDialog({
  open,
  onOpenChange,
  startTopUp = (cents) => client.billing.topUp({ cents }),
  redirect = (url) => window.location.assign(url),
}: AddCreditsDialogProps) {
  const { t } = useTranslation()
  const form = useForm({
    resolver: zodResolver(topUpForm),
    defaultValues: { amount: DEFAULT_DOLLARS },
  })
  const topUp = useApiMutation(
    { mutationFn: (cents: number) => startTopUp(cents), onSuccess: ({ url }) => redirect(url) },
    { context: '[usage] top-up failed', failure: t(`${KEY}.topUpNotOpened`) },
  )
  const busy = topUp.isPending || topUp.isSuccess
  const cents = topUpCents.safeParse(useWatch({ control: form.control, name: 'amount' }))
  const valid = cents.success
  const amounts = metricAmounts(cents.data ?? 0)
  const preview = amountsLine(METRIC_KEYS.map((metric) => ({ metric, amount: amounts[metric] })))

  const submit = ({ amount }: z.output<typeof topUpForm>) => topUp.run(amount)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => void form.handleSubmit(submit)(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t(`${KEY}.topUpTitle`)}</DialogTitle>
            <DialogDescription>{t(`${KEY}.topUpNote`)}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="top-up-amount">
              {t(`${KEY}.topUpAmount`, { currency: CURRENCY.toUpperCase() })}
            </Label>
            <Input
              id="top-up-amount"
              type="number"
              inputMode="decimal"
              min={TOP_UP.minCents / 100}
              max={TOP_UP.maxCents / 100}
              step={1}
              aria-invalid={!valid}
              aria-describedby="top-up-bounds"
              {...form.register('amount')}
            />
            <p
              id="top-up-bounds"
              data-bounds
              className={cn('text-sm', valid ? 'text-muted-foreground' : 'text-destructive')}
            >
              {t(`${KEY}.topUpBounds`, {
                min: money({ amount: TOP_UP.minCents, currency: CURRENCY }),
                max: money({ amount: TOP_UP.maxCents, currency: CURRENCY }),
              })}
            </p>
          </div>
          <p data-preview className="text-sm">
            {t(`${KEY}.topUpYouGet`, { amounts: preview })}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t(`${KEY}.topUpCancel`)}
            </Button>
            <Button type="submit" disabled={busy || !valid}>
              {t(`${KEY}.topUpPay`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
