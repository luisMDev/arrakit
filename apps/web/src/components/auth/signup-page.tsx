import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type ChoiceSearch, checkoutChoice, profileLanding } from '#/lib/checkout-choice'

import { CheckYourEmail } from './check-your-email'
import { type RefusalSearch, SignInOptions } from './sign-in-options'

export type SignupSearch = ChoiceSearch & RefusalSearch

export function signupLanding(mode: 'new' | 'returning', search: ChoiceSearch): string {
  return mode === 'returning' ? '/signin' : profileLanding(checkoutChoice(search))
}

export function SignupPage({ mode, search }: { mode: 'new' | 'returning'; search: SignupSearch }) {
  const { t } = useTranslation()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [lastSent, setLastSent] = useState('')

  return (
    <div className="flex grow flex-col px-4">
      <main className="flex grow flex-col items-center justify-center gap-8 py-12 text-center">
        {sentTo ? (
          <CheckYourEmail email={sentTo} onBack={() => setSentTo(null)} />
        ) : (
          <>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
              {t('signup.titleStart')}{' '}
              <span className="text-muted-foreground">{t('signup.titleEnd')}</span>
            </h1>
            <SignInOptions
              landing={signupLanding(mode, search)}
              email={lastSent}
              search={search}
              onSent={(email) => {
                setLastSent(email)
                setSentTo(email)
              }}
            />
            <p className="text-sm text-muted-foreground">{t('signup.noPassword')}</p>
          </>
        )}
      </main>
    </div>
  )
}
