import type { LucideIcon } from 'lucide-react'

import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '#/components/ui/empty'

/** The one way a screen says "nothing here yet": an icon and a title. */
export function EmptyState({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <Empty className="p-4 md:p-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  )
}
