import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CheckYourEmail } from '#/components/auth/check-your-email'
import { type RefusalSearch, SignInOptions } from '#/components/auth/sign-in-options'
import { APP_NAME } from '#/config'

import { authorizeResume } from './authorize-resume'

function refusalOf(search: string): RefusalSearch {
  const query = new URLSearchParams(search)
  return {
    error: query.get('error') ?? undefined,
    via: query.get('via') ?? undefined,
  }
}

export function OAuthSignInPage({ search = window.location.search }: { search?: string }) {
  const { t } = useTranslation()
  const [resume] = useState(() => authorizeResume(search))
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [lastSent, setLastSent] = useState('')

  return (
    <main className="flex grow flex-col items-center justify-center gap-8 px-4 py-12 text-center">
      {resume === null ? (
        <div className="flex max-w-md flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            {t('oauth.oauthSignin.incompleteTitle')}
          </h1>
          <p className="text-muted-foreground">
            {t('oauth.oauthSignin.startAgain', { appName: APP_NAME })}
          </p>
        </div>
      ) : sentTo ? (
        <CheckYourEmail email={sentTo} onBack={() => setSentTo(null)} />
      ) : (
        <>
          <div className="flex max-w-md flex-col gap-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t('oauth.oauthSignin.titleStart')}{' '}
              <span className="text-muted-foreground">
                {t('oauth.oauthSignin.titleEnd', { appName: APP_NAME })}
              </span>
            </h1>
            <p className="text-muted-foreground">{t('oauth.oauthSignin.useOrganizationAccount')}</p>
          </div>
          <SignInOptions
            landing={resume}
            email={lastSent}
            search={refusalOf(search)}
            onSent={(email) => {
              setLastSent(email)
              setSentTo(email)
            }}
          />
        </>
      )}
    </main>
  )
}
