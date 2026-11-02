import { isWorkEmail, normalizeEmail } from '@arrakit/address'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { useClearingForm } from '#/lib/form'
import { leave } from '#/lib/leave'
import { orpc } from '#/lib/orpc'
import { searchText } from '#/lib/search-params'
import { useApiMutation } from '#/lib/use-api-mutation'

import { PROVIDERS_UNKNOWN, type SocialProvider, sendMagicLink, socialSignInUrl } from './auth-api'

const PROVIDER_NAMES: Record<SocialProvider, string> = { google: 'Google', microsoft: 'Microsoft' }

const emailForm = z.object({ email: z.string().refine(isWorkEmail) })

export const refusalSearch = z.object({ error: searchText, via: searchText })
export type RefusalSearch = z.infer<typeof refusalSearch>

function refusalOf(search: RefusalSearch): SocialProvider | 'link' | null {
  if (search.error === undefined) return null
  return search.via === 'google' || search.via === 'microsoft' ? search.via : 'link'
}

function CheckYourEmail({ email, onBack }: { email: string; onBack: () => void }) {
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

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 23 23" className="size-[18px]">
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  )
}

/** Social buttons and the email form; once a link is sent, Check your email instead of all. */
export function SignInOptions({
  landing,
  search = {},
  children,
  footer,
}: {
  landing: string
  search?: RefusalSearch
  children?: ReactNode
  footer?: ReactNode
}) {
  const { t } = useTranslation()
  const providers = useQuery(orpc.authProviders.get.queryOptions()).data ?? PROVIDERS_UNKNOWN
  const refused = refusalOf(search)
  const form = useClearingForm({
    resolver: zodResolver(emailForm),
    defaultValues: { email: '' },
    mode: 'onTouched',
  })
  const [sentTo, setSentTo] = useState<string | null>(null)

  const magicLink = useApiMutation({
    mutationKey: ['auth', 'magicLink'],
    mutationFn: (email: string) => sendMagicLink(email, landing),
    onSuccess: (sent, email) => {
      if (!sent) return form.setError('email', { type: 'refused' })
      form.setValue('email', email)
      setSentTo(email)
    },
    meta: { failure: t('auth.signInOptions.linkNotSent') },
  })
  const social = useApiMutation({
    mutationKey: ['auth', 'social'],
    mutationFn: (provider: SocialProvider) => socialSignInUrl(provider, landing),
    onSuccess: leave,
    meta: { failure: t('auth.signInOptions.notSignedIn') },
  })
  const { reset: resetSocial } = social
  const pending = magicLink.isPending || social.busy

  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) resetSocial()
    }
    window.addEventListener('pageshow', shown)
    return () => window.removeEventListener('pageshow', shown)
  }, [resetSocial])

  const invalid = form.formState.errors.email !== undefined

  if (sentTo) return <CheckYourEmail email={sentTo} onBack={() => setSentTo(null)} />

  return (
    <>
      {children}
      <div className="flex w-full max-w-sm flex-col gap-3 text-left">
        {refused ? (
          <Alert variant="destructive">
            <AlertDescription>
              {refused === 'link'
                ? t('auth.signInOptions.linkRefused')
                : t('auth.signInOptions.providerRefused', { provider: PROVIDER_NAMES[refused] })}
            </AlertDescription>
          </Alert>
        ) : null}
        {providers.google ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={pending}
            onClick={() => void social.run('google')}
          >
            <GoogleIcon />
            {t('auth.signInOptions.continueWithGoogle')}
          </Button>
        ) : null}
        {providers.microsoft ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={pending}
            onClick={() => void social.run('microsoft')}
          >
            <MicrosoftIcon />
            {t('auth.signInOptions.continueWithMicrosoft')}
          </Button>
        ) : null}
        {providers.google || providers.microsoft ? (
          <div className="flex items-center gap-3 py-1" aria-hidden="true">
            <div className="h-px grow bg-border" />
            <span className="text-xs text-muted-foreground">{t('auth.signInOptions.or')}</span>
            <div className="h-px grow bg-border" />
          </div>
        ) : null}
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) =>
            void form.handleSubmit(({ email }) => magicLink.run(normalizeEmail(email)))(e)
          }
        >
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor="sign-in-email" className="sr-only">
              {t('auth.signInOptions.workEmail')}
            </FieldLabel>
            <Input
              id="sign-in-email"
              type="email"
              autoComplete="email"
              placeholder={t('auth.signInOptions.yourWorkEmail')}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? 'sign-in-email-error' : undefined}
              {...form.register('email')}
            />
            {invalid ? (
              <FieldError id="sign-in-email-error">
                {t('auth.signInOptions.workEmailError')}
              </FieldError>
            ) : null}
          </Field>
          <Button type="submit" size="lg" disabled={pending}>
            {t('auth.signInOptions.continue')}
          </Button>
        </form>
      </div>
      {footer}
    </>
  )
}
