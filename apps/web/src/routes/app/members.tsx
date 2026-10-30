import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/app/members')({
  beforeLoad: () => {
    throw redirect({ to: '/app/settings', search: { section: 'members' } })
  },
})
