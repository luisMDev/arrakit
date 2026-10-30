import { createFileRoute } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { APP_NAME } from '#/config'

// Placeholder: the real "/" redirects as described in docs/spec/web-shell-landing.md.
export const Route = createFileRoute('/')({ component: Index })

export function Index() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
      <Button asChild>
        <a href="/signin">Sign in</a>
      </Button>
    </main>
  )
}
