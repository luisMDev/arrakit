import type { AuthProviders } from '@arrakit/contract'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach } from 'vitest'

import { Toaster } from '#/components/ui/sonner'
import { answer, quiet, setupTestApi, withQueries } from '#/test/rpc'

/** `setupTestApi()`; every test begins with `providers` and quiet error logs. */
export function setupAuthTestApi(providers: AuthProviders = { google: true, microsoft: false }) {
  setupTestApi()
  beforeEach(() => {
    quiet()
    answer('authProviders/get', providers)
  })
}

export function renderWithQueries(ui: ReactNode) {
  return render(
    <>
      {ui}
      <Toaster />
    </>,
    { wrapper: withQueries() },
  )
}
