import { Loader2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import { APP_NAME } from '#/config'
import { reportError } from '#/lib/api-errors'
import { client } from '#/lib/orpc'
import { useApiMutation } from '#/lib/use-api-mutation'

import { consent, publicClientName } from './oauth-api'

type ConsentView =
  | { state: 'loading' }
  | { state: 'incomplete' }
  | { state: 'unavailable' }
  | { state: 'ask'; client: string; organization: string }
  | { state: 'no-organization'; client: string }

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
  const [view, setView] = useState<ConsentView>(() => {
    const query = new URLSearchParams(oauthQuery)
    return query.get('client_id') && query.get('sig')
      ? { state: 'loading' }
      : { state: 'incomplete' }
  })
  const answer = useApiMutation(
    {
      mutationFn: (accept: boolean) => consent(accept, oauthQuery),
      onSuccess: (url) => {
        window.location.href = url
      },
    },
    { context: '[oauth] consent failed', failure: t('oauth.oauthConsent.failed') },
  )
  const pending = answer.isPending || answer.isSuccess

  useEffect(() => {
    const clientId = new URLSearchParams(oauthQuery).get('client_id')
    if (!clientId || view.state !== 'loading') return
    let live = true
    Promise.all([publicClientName(clientId), client.me.get()]).then(
      ([name, { organization }]) => {
        if (!live) return
        setView(
          organization
            ? { state: 'ask', client: name, organization: organization.name }
            : { state: 'no-organization', client: name },
        )
      },
      (err: unknown) => {
        reportError('[oauth] could not load the consent request', err)
        if (live) setView({ state: 'unavailable' })
      },
    )
    return () => {
      live = false
    }
  }, [oauthQuery, view.state])

  const startAgain = t('oauth.oauthConsent.startAgain', { appName: APP_NAME })

  return (
    <main className="flex grow flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      {view.state === 'loading' ? (
        <div role="status" className="flex items-center gap-2 text-muted-foreground">
          <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
          {t('oauth.oauthConsent.loading')}
        </div>
      ) : view.state === 'incomplete' ? (
        <Message title={t('oauth.oauthConsent.incompleteTitle')} body={startAgain} />
      ) : view.state === 'unavailable' ? (
        <Message title={t('oauth.oauthConsent.unavailableTitle')} body={startAgain} />
      ) : (
        <div className="flex w-full max-w-sm flex-col gap-6">
          {view.state === 'ask' ? (
            <>
              <div className="flex flex-col gap-3">
                <h1 className="text-3xl font-semibold tracking-tight">
                  {t('oauth.oauthConsent.connect')}{' '}
                  <span className="text-muted-foreground">{view.client}</span>
                </h1>
                <p className="text-muted-foreground">
                  {t('oauth.oauthConsent.willSee', {
                    client: view.client,
                    organization: view.organization,
                  })}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Button size="lg" disabled={pending} onClick={() => void answer.run(true)}>
                  {t('oauth.oauthConsent.allow')}
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  disabled={pending}
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
                body={t('oauth.oauthConsent.noOrganizationBody', { client: view.client })}
              />
              <Button size="lg" disabled={pending} onClick={() => void answer.run(false)}>
                {t('oauth.oauthConsent.backTo', { client: view.client })}
              </Button>
            </>
          )}
        </div>
      )}
    </main>
  )
}
