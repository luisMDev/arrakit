import type { Me } from '@arrakit/contract'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import '#/i18n'
import { orpc } from '#/lib/orpc'

import { SettingsPage } from './settings-page'

function renderAs(role: Me['role'], section: 'account' | 'members' = 'account') {
  const queryClient = new QueryClient()
  queryClient.setQueryData(orpc.me.get.queryOptions().queryKey, {
    email: 'ana@acme.com',
    name: 'Ana',
    language: 'en',
    organization: {
      id: '0f8fad5b-d9cb-469f-a165-70867728950e',
      name: 'Acme',
      slug: 'acme',
      plan: 'free',
    },
    role,
    plan: 'free',
    seats: 1,
  } satisfies Me)
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage section={section} />
    </QueryClientProvider>,
  )
}

describe('SettingsPage shell', () => {
  it('hides admin-only sections from members and opens Account instead', () => {
    renderAs('member', 'members')
    expect(screen.queryByRole('button', { name: 'Members' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account' })).toHaveAttribute('aria-current', 'true')
  })

  it('switches sections in page for admins', async () => {
    renderAs('admin', 'members')
    expect(screen.getByRole('button', { name: 'Members' })).toHaveAttribute('aria-current', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'General' }))
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'true')
  })
})
