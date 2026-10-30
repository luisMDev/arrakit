import { isWorkEmail, normalizeEmail } from '@arrakit/address'
import type { AuthProviders } from '@arrakit/contract'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'

import { EmailRefusedError, PROVIDERS_UNKNOWN, type SocialProvider, useAuthApi } from './auth-api'
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

export function refusalOf(search: RefusalSearch): SocialProvider | 'link' | null {
  if (search.error === undefined) return null
  return search.via === 'google' || search.via === 'microsoft' ? search.via : 'link'
}

function useProviders(): AuthProviders {
  const api = useAuthApi()
  const [providers, setProviders] = useState(PROVIDERS_UNKNOWN)
  useEffect(() => {
    let live = true
    void api.providers().then((answer) => {
      if (live) setProviders(answer)
    })
    return () => {
      live = false
    }
  }, [api])
  return providers
}

export function SignInOptions({
  landing,
  email: initialEmail = '',
  search = {},
  onSent,
}: {
  landing: string
  email?: string
  search?: RefusalSearch
  onSent: (email: string) => void
}) {
  const { t } = useTranslation()
  const api = useAuthApi()
  const providers = useProviders()
  const refused = refusalOf(search)
  const form = useForm({
    resolver: zodResolver(emailForm),
    defaultValues: { email: initialEmail },
    mode: 'onTouched',
  })
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)

  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) {
        pendingRef.current = false
        setPending(false)
      }
    }
    window.addEventListener('pageshow', shown)
    return () => window.removeEventListener('pageshow', shown)
  }, [])

  const begin = () => {
    if (pendingRef.current) return false
    pendingRef.current = true
    setPending(true)
    return true
  }
  const fail = () => {
    pendingRef.current = false
    setPending(false)
  }

  const invalid = form.formState.errors.email !== undefined

  async function continueWithEmail({ email }: z.output<typeof emailForm>) {
    if (!begin()) return
    const normalized = normalizeEmail(email)
    try {
      await api.sendMagicLink(normalized, landing)
      onSent(normalized)
    } catch (err) {
      fail()
      if (err instanceof EmailRefusedError) form.setError('email', { type: 'refused' })
      else toast.error(t('auth.signInOptions.linkNotSent'))
    }
  }

  async function continueWith(provider: SocialProvider) {
    if (!begin()) return
    try {
      await api.signInWith(provider, landing)
    } catch {
      fail()
      toast.error(t('auth.signInOptions.notSignedIn'))
    }
  }

  return (
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
          onClick={() => void continueWith('google')}
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
          onClick={() => void continueWith('microsoft')}
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
        onSubmit={(e) => void form.handleSubmit(continueWithEmail)(e)}
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
  )
}
