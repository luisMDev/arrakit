import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'

export function NotFoundPage() {
  const { t } = useTranslation()

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 p-6">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">{t('notFound.title')}</h1>
      <p className="text-muted-foreground">{t('notFound.body')}</p>
      <Button asChild>
        <Link to="/">{t('notFound.home')}</Link>
      </Button>
    </main>
  )
}
