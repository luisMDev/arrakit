import type { ReactNode } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'

export function PagePlaceholder({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{title}</h1>
          </CardTitle>
        </CardHeader>
        {children ? <CardContent>{children}</CardContent> : null}
      </Card>
    </main>
  )
}
