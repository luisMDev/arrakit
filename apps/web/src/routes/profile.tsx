import { createFileRoute } from '@tanstack/react-router'

import { ProfilePage } from '#/components/onboarding/profile-page'
import { choiceSearch } from '#/lib/checkout-choice'
import { requireAccount } from '#/lib/guards/require-account'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/profile')({
  validateSearch: choiceSearch,
  beforeLoad: requireAccount,
  head: titled('yourOrganization'),
  component: function Profile() {
    const navigate = Route.useNavigate()
    return <ProfilePage search={Route.useSearch()} onDone={(target) => void navigate(target)} />
  },
})
