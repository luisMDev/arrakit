import { isWorkEmail } from '@arrakit/address'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { AuthRequestError, EmailRefusedError, useAuthApi } from '#/components/auth/auth-api'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Spinner } from '#/components/ui/spinner'
import { apiMessage, reportError, statusOf } from '#/lib/api-errors'
import { registerClearing, useClearingForm } from '#/lib/form'
import { client } from '#/lib/orpc'

const joinForm = (workEmailError: string) =>
  z.object({ email: z.string().trim().refine(isWorkEmail, workEmailError) })

export type JoinState = 'joining' | 'signed-out' | 'sent' | 'taken' | 'closed' | 'failed'

export function joinStateFor(err: unknown): JoinState {
  const status = statusOf(err)
  if (status === 401) return 'signed-out'
  if (status === 409) return 'taken'
  if (status === 404) return 'closed'
  return 'failed'
}

function Heading({ start, end }: { start: string; end: string }) {
  return (
    <CardTitle className="text-2xl">
      {start} <span className="text-muted-foreground">{end}</span>
    </CardTitle>
  )
}

export function JoinPage({ invitationId }: { invitationId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const auth = useAuthApi()
  const [state, setState] = useState<JoinState>('joining')
  const form = useClearingForm({
    resolver: zodResolver(joinForm(t('join.workEmail'))),
    defaultValues: { email: '' },
  })
  const emailError = form.formState.errors.email?.message
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    client.invitations.accept({ id: invitationId }).then(
      () => void navigate({ to: '/app', replace: true }),
      (err: unknown) => {
        const next = joinStateFor(err)
        if (next === 'failed') reportError('[join] joining failed', err)
        setState(next)
      },
    )
  }, [invitationId, navigate])

  function sendFailure(err: unknown): string {
    if (err instanceof EmailRefusedError) return t('join.workEmail')
    const status = err instanceof AuthRequestError ? err.status : statusOf(err)
    if (status === 429) return t('join.tooManyLinks')
    const message = apiMessage(err)
    if (message) return message
    reportError('[join] sending a new link failed', err)
    return t('join.linkNotSent')
  }

  async function sendLink({ email }: z.output<ReturnType<typeof joinForm>>) {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      await auth.sendMagicLink(email, `/join/${encodeURIComponent(invitationId)}`)
      setState('sent')
    } catch (err) {
      form.setError('email', { type: 'send', message: sendFailure(err) })
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  const signInLink = (variant: 'default' | 'ghost') => (
    <Button asChild variant={variant}>
      <Link to="/signin">{t('join.signIn')}</Link>
    </Button>
  )

  return (
    <main className="flex grow items-center justify-center p-6">
      <Card className="w-full max-w-md">
        {state === 'joining' ? (
          <CardContent className="flex items-center gap-3" role="status">
            <Spinner role="presentation" aria-hidden="true" />
            <span>{t('join.joining')}</span>
          </CardContent>
        ) : null}

        {state === 'signed-out' ? (
          <>
            <CardHeader>
              <Heading start={t('join.expiredStart')} end={t('join.expiredEnd')} />
              <CardDescription>{t('join.expiredBody')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                noValidate
                onSubmit={(event) => void form.handleSubmit(sendLink)(event)}
                className="flex flex-col gap-4"
              >
                <Field data-invalid={emailError ? true : undefined}>
                  <FieldLabel htmlFor="join-email">{t('join.yourWorkEmail')}</FieldLabel>
                  <Input
                    id="join-email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@organization.com"
                    aria-invalid={emailError ? true : undefined}
                    {...registerClearing(form, 'email')}
                  />
                  {emailError ? <FieldError>{emailError}</FieldError> : null}
                </Field>
                <Button type="submit" disabled={pending}>
                  {t('join.sendNewLink')}
                </Button>
              </form>
            </CardContent>
          </>
        ) : null}

        {state === 'sent' ? (
          <CardHeader>
            <Heading start={t('join.checkStart')} end={t('join.checkEnd')} />
            <CardDescription>{t('join.sentBody')}</CardDescription>
          </CardHeader>
        ) : null}

        {state === 'taken' || state === 'closed' || state === 'failed' ? (
          <>
            <CardHeader>
              <CardTitle className="text-xl">{t(`join.${state}Title`)}</CardTitle>
              <CardDescription>{t(`join.${state}Body`)}</CardDescription>
            </CardHeader>
            <CardContent>{signInLink(state === 'failed' ? 'ghost' : 'default')}</CardContent>
          </>
        ) : null}
      </Card>
    </main>
  )
}
