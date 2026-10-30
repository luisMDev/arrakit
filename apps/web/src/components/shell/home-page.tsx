import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import { useCurrentUser } from '#/lib/current-user'

/** The first screen once signed in: where the product's own dashboard starts. */
export function HomePage() {
  const { t } = useTranslation()
  const { user, name, isAdmin, planLabel } = useCurrentUser()
  if (!user?.organization) return null
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('home.title', { name })}</h1>
        <p className="text-muted-foreground">
          {t('home.organization', { organization: user.organization.name, plan: planLabel })}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/app/settings">{t('home.settings')}</Link>
        </Button>
        {isAdmin ? (
          <>
            <Button asChild variant="outline">
              <Link to="/app/settings" search={{ section: 'members' }}>
                {t('home.members')}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/app/plans">{t('home.plans')}</Link>
            </Button>
          </>
        ) : null}
      </div>
    </main>
  )
}
