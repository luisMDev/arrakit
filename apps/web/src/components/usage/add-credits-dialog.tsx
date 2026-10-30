import { CURRENCY, METRIC_KEYS, TOP_UP, isTopUpAmount, metricAmounts } from '@arrakit/plans'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
import { tr } from '#/i18n'
import { apiCall } from '#/lib/api-errors'
import { client } from '#/lib/orpc'
import { cn } from '#/lib/utils'

import { amountsLine, money } from './usage-copy'

const KEY = 'settings.billingSettings.usage'
const DEFAULT_DOLLARS = String(2_000 / 100)

export function toCents(value: string): number | null {
  return value.trim() === '' ? null : Math.round(Number(value) * 100)
}

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
  const [value, setValue] = useState(DEFAULT_DOLLARS)
  const [busy, setBusy] = useState(false)
  const cents = toCents(value)
  const valid = isTopUpAmount(cents)
  const amounts = metricAmounts(valid ? cents : 0)
  const preview = amountsLine(METRIC_KEYS.map((metric) => ({ metric, amount: amounts[metric] })))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!isTopUpAmount(cents)) return
    setBusy(true)
    const result = await apiCall(() => startTopUp(cents), tr(`${KEY}.topUpNotOpened`), {
      failed: () => setBusy(false),
    })
    if (result) redirect(result.url)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
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
              name="amount"
              type="number"
              inputMode="decimal"
              min={TOP_UP.minCents / 100}
              max={TOP_UP.maxCents / 100}
              step={1}
              value={value}
              aria-invalid={!valid}
              aria-describedby="top-up-bounds"
              onChange={(e) => setValue(e.target.value)}
            />
            <p
              id="top-up-bounds"
              data-bounds
              className={cn('text-sm', valid ? 'text-muted-foreground' : 'text-destructive')}
            >
              {t(`${KEY}.topUpBounds`, {
                min: money(TOP_UP.minCents),
                max: money(TOP_UP.maxCents),
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
