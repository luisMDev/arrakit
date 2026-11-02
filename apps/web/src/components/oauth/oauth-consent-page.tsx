import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import { Field, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { APP_NAME } from '#/config'
import { authCall } from '#/lib/auth-call'
import { authClient } from '#/lib/auth-client'
import { leave } from '#/lib/leave'
import { orpc } from '#/lib/orpc'
import { oauthClient } from '#/lib/oauth-client'
import { organizationQueries } from '#/lib/organization-queries'
import { useApiMutation } from '#/lib/use-api-mutation'

/** The connector's `client_name`, or its id when it gave none. */
async function publicClientName(clientId: string): Promise<string> {
  const body = await authCall(oauthClient.oauth2.publicClient({ query: { client_id: clientId } }))
  return body.client_name || body.client_id
}

/** Allows or denies the request (`oauthQuery`, exactly as received); resolves to where to go next. */
async function consent(accept: boolean, oauthQuery: string): Promise<string> {
  const body = await authCall(oauthClient.oauth2.consent({ accept, oauth_query: oauthQuery }))
  const url = body.url ?? (body as { redirect_uri?: string }).redirect_uri
  if (!url) throw new Error('[oauth] the consent answer named no redirect')
  return url
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex max-w-md flex-col gap-3">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{body}</p>
    </div>
  )
}

export function OAuthConsentPage({ search = window.location.search }: { search?: string }) {
  const { t } = useTranslation()
  const [oauthQuery] = useState(() => (search.startsWith('?') ? search.slice(1) : search))
  const params = new URLSearchParams(oauthQuery)
  const clientId = params.get('client_id') ?? ''
  const complete = clientId !== '' && !!params.get('sig')
  const clientName = useQuery({
    queryKey: ['oauth', 'client', clientId],
    queryFn: () => publicClientName(clientId),
    enabled: complete,
  })
  const queryClient = useQueryClient()
  const meQuery = orpc.me.get.queryOptions()
  const me = useQuery({ ...meQuery, enabled: complete })
  const organizations = useQuery({
    ...organizationQueries.list(),
    enabled: complete && !!me.data?.organization,
  })
  const choose = useApiMutation({
    mutationKey: ['oauth', 'organization'],
    mutationFn: (organizationId: string) =>
      authCall(authClient.organization.setActive({ organizationId })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: meQuery.queryKey }),
    meta: { failure: t('oauth.oauthConsent.notSwitched') },
  })
  const answer = useApiMutation({
    mutationKey: ['oauth', 'consent'],
    mutationFn: (accept: boolean) => consent(accept, oauthQuery),
    onSuccess: leave,
    meta: { failure: t('oauth.oauthConsent.failed') },
  })

  const startAgain = t('oauth.oauthConsent.startAgain', { appName: APP_NAME })

  return (
    <main className="flex grow flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      {!complete ? (
        <Message title={t('oauth.oauthConsent.incompleteTitle')} body={startAgain} />
      ) : clientName.isError || me.isError ? (
        <Message title={t('oauth.oauthConsent.unavailableTitle')} body={startAgain} />
      ) : !clientName.data || !me.data ? (
        <div role="status" className="flex items-center gap-2 text-muted-foreground">
          <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
          {t('oauth.oauthConsent.loading')}
        </div>
      ) : (
        <div className="flex w-full max-w-sm flex-col gap-6">
          {me.data.organization ? (
            <>
              <div className="flex flex-col gap-3">
                <h1 className="text-3xl font-semibold tracking-tight">
                  {t('oauth.oauthConsent.connect')}{' '}
                  <span className="text-muted-foreground">{clientName.data}</span>
                </h1>
                <p className="text-muted-foreground">
                  {t('oauth.oauthConsent.willSee', {
                    client: clientName.data,
                    organization: me.data.organization.name,
                  })}
                </p>
              </div>
              {organizations.data && organizations.data.length > 1 ? (
                <Field className="text-left">
                  <FieldLabel htmlFor="oauth-organization">
                    {t('oauth.oauthConsent.organization')}
                  </FieldLabel>
                  <Select
                    value={me.data.organization.id}
                    disabled={choose.isPending || answer.busy}
                    onValueChange={(id) => void choose.run(id)}
                  >
                    <SelectTrigger id="oauth-organization" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {organizations.data.map((organization) => (
                        <SelectItem key={organization.id} value={organization.id}>
                          {organization.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              <div className="flex flex-col gap-2">
                <Button
                  size="lg"
                  disabled={answer.busy || choose.isPending}
                  onClick={() => void answer.run(true)}
                >
                  {t('oauth.oauthConsent.allow')}
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  disabled={answer.busy}
                  onClick={() => void answer.run(false)}
                >
                  {t('oauth.oauthConsent.deny')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Message
                title={t('oauth.oauthConsent.noOrganizationTitle')}
                body={t('oauth.oauthConsent.noOrganizationBody', { client: clientName.data })}
              />
              <Button size="lg" disabled={answer.busy} onClick={() => void answer.run(false)}>
                {t('oauth.oauthConsent.backTo', { client: clientName.data })}
              </Button>
            </>
          )}
        </div>
      )}
    </main>
  )
}
