import { createFileRoute } from '@tanstack/react-router'

import { JoinPage } from '#/components/organizations/join-page'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/join/$invitationId')({
  head: titled('joinYourOrganization'),
  component: function Join() {
    return <JoinPage invitationId={Route.useParams().invitationId} />
  },
})
