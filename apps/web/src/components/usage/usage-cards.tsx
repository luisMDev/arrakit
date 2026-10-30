import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Progress } from '#/components/ui/progress'

import {
  type MetricUsage,
  availableLine,
  metricLabel,
  resetLine,
  splitLine,
  usedLine,
  usedPercent,
} from './usage-copy'

export function UsageCards({ metrics }: { metrics: MetricUsage[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {metrics.map((metric) => (
        <Card key={metric.metric} data-metric={metric.metric} className="gap-3">
          <CardHeader>
            <CardTitle className="text-muted-foreground text-sm font-normal">
              {metricLabel(metric.metric)}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <span data-available className="text-2xl font-semibold">
              {availableLine(metric)}
            </span>
            <span data-split className="text-muted-foreground text-sm">
              {splitLine(metric)}
            </span>
            <Progress
              value={usedPercent(metric)}
              aria-valuenow={usedPercent(metric)}
              aria-label={usedLine(metric)}
            />
            <span data-used className="text-sm">
              {usedLine(metric)}
            </span>
            <span data-resets className="text-muted-foreground text-sm">
              {resetLine(metric)}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
