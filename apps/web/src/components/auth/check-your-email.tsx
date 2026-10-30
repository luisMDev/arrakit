import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'

export function CheckYourEmail({ email, onBack }: { email: string; onBack: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {t('auth.checkYourEmail.titleStart')}{' '}
        <span className="text-muted-foreground">{t('auth.checkYourEmail.titleEnd')}</span>
      </h1>
      <p className="max-w-md text-muted-foreground">{t('auth.checkYourEmail.sentTo', { email })}</p>
      <Button type="button" variant="ghost" onClick={onBack}>
        {t('auth.checkYourEmail.useDifferentEmail')}
      </Button>
      <p className="text-sm text-muted-foreground">{t('auth.checkYourEmail.linkWorksOnce')}</p>
    </div>
  )
}
