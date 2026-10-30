import { Loader2Icon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { APP_NAME } from '#/config'
import { reportError } from '#/lib/api-errors'

import { useOAuthApi } from './oauth-api'

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
  const api = useOAuthApi()
  const [oauthQuery] = useState(() => (search.startsWith('?') ? search.slice(1) : search))
  const [view, setView] = useState<ConsentView>(() => {
    const query = new URLSearchParams(oauthQuery)
    return query.get('client_id') && query.get('sig')
      ? { state: 'loading' }
      : { state: 'incomplete' }
  })
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const pendingRef = useRef(false)

  useEffect(() => {
    const clientId = new URLSearchParams(oauthQuery).get('client_id')
    if (!clientId || view.state !== 'loading') return
    let live = true
    Promise.all([api.publicClient(clientId), api.currentOrganization()]).then(
      ([client, organization]) => {
        if (!live) return
        setView(
          organization
            ? { state: 'ask', client: client.name, organization: organization.name }
            : { state: 'no-organization', client: client.name },
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
  }, [api, oauthQuery, view.state])

  async function answer(accept: boolean) {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setFailed(false)
    try {
      await api.consent(accept, oauthQuery)
    } catch (err) {
      reportError('[oauth] consent failed', err)
      pendingRef.current = false
      setPending(false)
      setFailed(true)
    }
  }

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
                <Button size="lg" disabled={pending} onClick={() => void answer(true)}>
                  {t('oauth.oauthConsent.allow')}
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => void answer(false)}
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
              <Button size="lg" disabled={pending} onClick={() => void answer(false)}>
                {t('oauth.oauthConsent.backTo', { client: view.client })}
              </Button>
            </>
          )}
          {failed ? (
            <Alert variant="destructive">
              <AlertDescription>{t('oauth.oauthConsent.failed')}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      )}
    </main>
  )
}
