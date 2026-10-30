import { isWorkEmail } from '@arrakit/address'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { sendMagicLink } from '#/components/auth/auth-api'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Spinner } from '#/components/ui/spinner'
import { apiMessage, reportError, statusOf } from '#/lib/api-errors'
import { authCall, codeOf } from '#/lib/auth-call'
import { authClient } from '#/lib/auth-client'
import { registerClearing, useClearingForm } from '#/lib/form'
import { switchOrganization } from '#/lib/organization-queries'
import { useApiMutation } from '#/lib/use-api-mutation'

const joinForm = (workEmailError: string) =>
  z.object({ email: z.string().trim().refine(isWorkEmail, workEmailError) })

type Refusal = 'signed-out' | 'already' | 'closed' | 'failed'

const CLOSED_CODES = new Set([
  'INVITATION_NOT_FOUND',
  'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION',
  'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION',
])

function refusalOf(err: unknown): Refusal {
  const status = statusOf(err)
  if (status === 401) return 'signed-out'
  if (status === 409) return 'already'
  if (status === 404 || CLOSED_CODES.has(codeOf(err) ?? '')) return 'closed'
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
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [sent, setSent] = useState(false)
  const form = useClearingForm({
    resolver: zodResolver(joinForm(t('join.workEmail'))),
    defaultValues: { email: '' },
  })
  const emailError = form.formState.errors.email?.message
  const joining = useApiMutation({
    mutationKey: ['org', 'acceptInvitation'],
    mutationFn: async () => {
      const { member } = await authCall(authClient.organization.acceptInvitation({ invitationId }))
      await switchOrganization(queryClient, member.organizationId)
    },
    onSuccess: () => void navigate({ to: '/app', replace: true }),
  })
  const { run: join } = joining
  useEffect(() => {
    void join()
  }, [join])
  const state = sent ? 'sent' : joining.error ? refusalOf(joining.error) : 'joining'

  function sendFailure(err: unknown): string {
    if (statusOf(err) === 429) return t('join.tooManyLinks')
    const message = apiMessage(err)
    if (message) return message
    reportError('[join] sending a new link failed', err)
    return t('join.linkNotSent')
  }

  async function sendLink({ email }: z.output<ReturnType<typeof joinForm>>) {
    try {
      if (await sendMagicLink(email, `/join/${encodeURIComponent(invitationId)}`)) setSent(true)
      else form.setError('email', { type: 'send', message: t('join.workEmail') })
    } catch (err) {
      form.setError('email', { type: 'send', message: sendFailure(err) })
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
                <Button type="submit" disabled={form.formState.isSubmitting}>
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

        {state === 'already' ? (
          <>
            <CardHeader>
              <CardTitle className="text-xl">{t('join.alreadyTitle')}</CardTitle>
              <CardDescription>
                {apiMessage(joining.error) ?? t('join.alreadyBody')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link to="/app">{t('join.openApp')}</Link>
              </Button>
            </CardContent>
          </>
        ) : null}

        {state === 'closed' || state === 'failed' ? (
          <>
            <CardHeader>
              <CardTitle className="text-xl">{t(`join.${state}Title`)}</CardTitle>
              <CardDescription>
                {(state === 'failed' && apiMessage(joining.error)) || t(`join.${state}Body`)}
              </CardDescription>
            </CardHeader>
            <CardContent>{signInLink(state === 'failed' ? 'ghost' : 'default')}</CardContent>
          </>
        ) : null}
      </Card>
    </main>
  )
}
