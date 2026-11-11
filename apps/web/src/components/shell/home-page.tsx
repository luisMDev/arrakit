import { Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { planLabel } from '#/components/billing/plan-copy'
import { Button } from '#/components/ui/button'
import { WorkspaceFormDialog } from '#/components/workspaces/workspace-form-dialog'
import { useMember } from '#/lib/current-user'

/** Home while the organization has no workspace to open; with one, Home is that workspace's. */
export function HomePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, name, can, managesMembers, managesBilling } = useMember()
  const [creating, setCreating] = useState(false)
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('home.title', { name })}</h1>
        <p className="text-muted-foreground">
          {t('home.organization', {
            organization: user.organization.name,
            plan: planLabel(user.plan),
          })}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {can({ workspace: ['create'] }) ? (
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t('workspaces.new')}
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link to="/app/settings">{t('home.settings')}</Link>
        </Button>
        {managesMembers ? (
          <Button asChild variant="outline">
            <Link to="/app/settings" search={{ section: 'members' }}>
              {t('home.members')}
            </Link>
          </Button>
        ) : null}
        {managesBilling ? (
          <Button asChild variant="outline">
            <Link to="/app/plans">{t('home.plans')}</Link>
          </Button>
        ) : null}
      </div>
      <WorkspaceFormDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(workspace) =>
          void navigate({
            to: '/app/workspaces/$workspaceId',
            params: { workspaceId: workspace.id },
          })
        }
      />
    </main>
  )
}
