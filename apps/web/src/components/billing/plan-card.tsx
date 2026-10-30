import type { PlanOfferView } from '@arrakit/contract'
import type { BillingCycle } from '@arrakit/plans'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { cn } from '#/lib/utils'

import { planLabel, planPrice } from './plan-copy'

export function PlanCard({
  offer,
  cycle,
  priceNote,
  badge,
  highlighted = false,
  action,
  children,
}: {
  offer: PlanOfferView
  cycle: BillingCycle
  priceNote: string | null
  badge?: string
  highlighted?: boolean
  action?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const price = planPrice(offer, cycle)
  const label = planLabel(offer.plan)
  return (
    <Card
      aria-label={label}
      role="article"
      className={cn('flex flex-col', highlighted && 'border-primary ring-primary ring-1')}
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xl">{label}</CardTitle>
          {badge && <Badge>{badge}</Badge>}
        </div>
        <CardDescription>{t(`pricing.audience.${offer.plan}`)}</CardDescription>
        <p className="mt-2 flex items-baseline gap-2">
          {price.was && (
            <span className="text-muted-foreground text-lg line-through">{price.was}</span>
          )}
          <span className="text-3xl font-semibold">{price.price}</span>
          <span className="text-muted-foreground text-sm">{t('pricing.perMonth')}</span>
        </p>
        {priceNote && <p className="text-muted-foreground text-sm">{priceNote}</p>}
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
      {action && <CardFooter>{action}</CardFooter>}
    </Card>
  )
}

export function FeatureList({ items, label }: { items: string[]; label?: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-2 text-sm">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <Check aria-hidden className="text-primary mt-0.5 size-4 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}
