import { HeadContent, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { RootLayout } from '#/components/shell/root-layout'
import { RouteError } from '#/components/shell/unavailable-page'
import { ThemeProvider } from '#/components/shell/theme-provider'
import { Toaster } from '#/components/ui/sonner'
import { TooltipProvider } from '#/components/ui/tooltip'
import { ANALYTICS, APP_NAME } from '#/config'
import { languageSettled } from '#/i18n'
import appCss from '../styles.css?url'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: APP_NAME },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
    scripts: ANALYTICS
      ? [{ src: ANALYTICS.src, defer: true, 'data-domain': ANALYTICS.domain }]
      : [],
  }),
  // The initial language (remembered or the browser's) is settled before any screen renders.
  beforeLoad: () => languageSettled(),
  shellComponent: RootDocument,
  component: RootLayout,
  errorComponent: RouteError,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
