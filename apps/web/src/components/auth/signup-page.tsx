import { useTranslation } from 'react-i18next'
import type { z } from 'zod'

import {
  type ChoiceSearch,
  checkoutChoice,
  choiceSearch,
  profileLanding,
} from '#/lib/checkout-choice'

import { SignInOptions, refusalSearch } from './sign-in-options'

export const signupSearch = choiceSearch.extend(refusalSearch.shape)
export type SignupSearch = z.infer<typeof signupSearch>

function signupLanding(mode: 'new' | 'returning', search: ChoiceSearch): string {
  return mode === 'returning' ? '/signin' : profileLanding(checkoutChoice(search))
}

export function SignupPage({ mode, search }: { mode: 'new' | 'returning'; search: SignupSearch }) {
  const { t } = useTranslation()

  return (
    <div className="flex grow flex-col px-4">
      <main className="flex grow flex-col items-center justify-center gap-8 py-12 text-center">
        <SignInOptions
          landing={signupLanding(mode, search)}
          search={search}
          footer={<p className="text-sm text-muted-foreground">{t('signup.noPassword')}</p>}
        >
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            {t('signup.titleStart')}{' '}
            <span className="text-muted-foreground">{t('signup.titleEnd')}</span>
          </h1>
        </SignInOptions>
      </main>
    </div>
  )
}
