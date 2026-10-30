import type { AuthProviders } from '@arrakit/contract'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'

import { Toaster } from '#/components/ui/sonner'
import { answer, api, quiet, withQueries } from '#/test/rpc'

/** Starts the msw server for the file; every test begins with `providers` and quiet error logs. */
export function setupAuthTestApi(providers: AuthProviders = { google: true, microsoft: false }) {
  beforeAll(() => api.listen({ onUnhandledFrame: 'bypass' }))
  beforeEach(() => {
    quiet()
    answer('authProviders/get', providers)
  })
  afterEach(() => {
    api.resetHandlers()
    vi.restoreAllMocks()
  })
  afterAll(() => api.close())
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
