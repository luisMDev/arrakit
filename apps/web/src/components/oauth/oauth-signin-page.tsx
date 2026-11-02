import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SignInOptions, refusalSearch } from '#/components/auth/sign-in-options'
import { APP_NAME } from '#/config'

import { authorizeResume } from './authorize-resume'

export function OAuthSignInPage({ search = window.location.search }: { search?: string }) {
  const { t } = useTranslation()
  const [resume] = useState(() => authorizeResume(search))

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
      ) : (
        <SignInOptions
          landing={resume}
          search={refusalSearch.parse(Object.fromEntries(new URLSearchParams(search)))}
        >
          <div className="flex max-w-md flex-col gap-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t('oauth.oauthSignin.titleStart')}{' '}
              <span className="text-muted-foreground">
                {t('oauth.oauthSignin.titleEnd', { appName: APP_NAME })}
              </span>
            </h1>
            <p className="text-muted-foreground">{t('oauth.oauthSignin.useOrganizationAccount')}</p>
          </div>
        </SignInOptions>
      )}
    </main>
  )
}
