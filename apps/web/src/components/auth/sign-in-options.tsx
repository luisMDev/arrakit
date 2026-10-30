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
import { useApiMutation } from '#/lib/use-api-mutation'

import { PROVIDERS_UNKNOWN, type SocialProvider, sendMagicLink, socialSignInUrl } from './auth-api'
import { CheckYourEmail } from './check-your-email'
import { GoogleIcon, MicrosoftIcon } from './provider-icons'

export interface RefusalSearch {
  error?: string
  via?: string
}

const PROVIDER_NAMES: Record<SocialProvider, string> = { google: 'Google', microsoft: 'Microsoft' }

const emailForm = z.object({ email: z.string().refine(isWorkEmail) })

const searchText = (value: unknown) =>
  value === undefined || value === null ? undefined : String(value)

export function refusalSearch(search: Record<string, unknown>): RefusalSearch {
  const error = searchText(search.error)
  const via = searchText(search.via)
  return { ...(error === undefined ? {} : { error }), ...(via === undefined ? {} : { via }) }
}

function refusalOf(search: RefusalSearch): SocialProvider | 'link' | null {
  if (search.error === undefined) return null
  return search.via === 'google' || search.via === 'microsoft' ? search.via : 'link'
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
