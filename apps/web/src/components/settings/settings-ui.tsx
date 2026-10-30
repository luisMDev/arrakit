import type { ReactNode } from 'react'

import { Card, CardContent } from '#/components/ui/card'
import { Separator } from '#/components/ui/separator'

export function SettingsSectionLayout({
  id,
  title,
  aside,
  children,
}: {
  id: string
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-labelledby={`settings-${id}`} className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`settings-${id}`} className="text-lg font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function SettingsHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-muted-foreground text-sm font-medium">{children}</h3>
}

export function SettingRow({
  label,
  children,
  action,
}: {
  label: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div data-label className="text-muted-foreground w-36 shrink-0 text-sm">
        {label}
      </div>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function SettingsCard({ children }: { children: ReactNode[] | ReactNode }) {
  const rows = (Array.isArray(children) ? children : [children]).filter(Boolean)
  return (
    <Card className="py-2">
      <CardContent>
        {rows.map((row, index) => (
          <div key={index}>
            {index > 0 ? <Separator /> : null}
            {row}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
