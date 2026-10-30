import type { AccountView } from '@arrakit/contract'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Switch } from '#/components/ui/switch'
import { type Language, isLanguage, loadLanguage } from '#/i18n'
import {
  type SaveOnChange,
  reportError,
  saveOnChange,
  statusOf,
  toastError,
  toastInfo,
} from '#/lib/api-errors'
import { authClient } from '#/lib/auth-client'
import { displayName, initialOf, useCurrentUser } from '#/lib/current-user'
import { client, orpc } from '#/lib/orpc'

import { apiMessage } from './api-message'
import { ConfirmDeleteDialog } from './confirm-delete-dialog'
import type { SectionProps } from './settings-page'
import { SettingRow, SettingsCard, SettingsHeading, SettingsSectionLayout } from './settings-ui'

const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', es: 'Español' }

export const TIME_ZONES: { zone: string; key: string }[] = [
  { zone: 'Europe/Madrid', key: 'zoneMadrid' },
  { zone: 'Europe/London', key: 'zoneLondon' },
  { zone: 'America/New_York', key: 'zoneNewYork' },
  { zone: 'America/Chicago', key: 'zoneChicago' },
  { zone: 'America/Los_Angeles', key: 'zoneLosAngeles' },
  { zone: 'America/Santiago', key: 'zoneSantiago' },
]

const K = 'settings.accountSettings'

type AccountUpdate = Parameters<typeof client.me.account.update>[0]

interface QueuedChange {
  changes: AccountUpdate
  id: number
}

type Translate = (key: string, params?: Record<string, unknown>) => string

/** "This Mac and an iPhone": the current device first, the others with their article. */
export function devicesLine(devices: string[], t: Translate, language: string): string {
  if (devices.length === 0) return t(`${K}.noDevice`)
  const [first, ...others] = devices as [string, ...string[]]
  const parts = [
    t(`${K}.thisDevice`, { device: first }),
    ...others.map((device) =>
      t(/^[aeiou]/i.test(device) ? `${K}.anDevice` : `${K}.aDevice`, { device }),
    ),
  ]
  return new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(parts)
}

/** The account as it reads once `changes` are saved. */
export function withChanges(account: AccountView, changes: AccountUpdate): AccountView {
  return {
    ...account,
    name: changes.name ?? account.name,
    language: changes.language ?? account.language,
    timeZone: changes.timeZone ?? account.timeZone,
    emails: { productNews: changes.emails?.productNews ?? account.emails.productNews },
  }
}

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export function AccountSection({ open }: SectionProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useCurrentUser()
  const accountQuery = orpc.me.account.get.queryOptions()
  // Loaded when the section opens and after a failure or a sign-out, never in the background:
  // a refetch landing between queued saves would put back a choice the person just made.
  const { data: account, error } = useQuery({
    ...accountQuery,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const [draftName, setDraftName] = useState<string | null>(null)
  const [nameError, setNameError] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const signingOutRef = useRef(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const zoneFilled = useRef(false)

  useEffect(() => {
    if (error && !account) {
      reportError('[account] loading the account failed', error)
      toastError(t(`${K}.notLoaded`))
    }
  }, [error, account, t])

  /** The saved account, fresh; a failure says `failure` and keeps what the screen shows. */
  async function load(failure: string) {
    try {
      await queryClient.fetchQuery({ ...accountQuery, staleTime: 0 })
    } catch (err) {
      reportError('[account] reloading the account failed', err)
      toastError(failure)
    }
  }

  async function applySaved(saved: AccountView, latest: boolean) {
    if (latest) queryClient.setQueryData<AccountView>(accountQuery.queryKey, saved)
    me.patch((current) => ({ ...current, name: saved.name, language: saved.language }))
    if (isLanguage(saved.language)) await loadLanguage(saved.language)
  }

  const handlers = useRef({ applySaved, load, t })
  useEffect(() => {
    handlers.current = { applySaved, load, t }
  })

  const lastChange = useRef(0)
  const saver = useRef<SaveOnChange<QueuedChange> | null>(null)

  /** Shows the change at once and queues its save behind the ones still running. */
  function save(changes: AccountUpdate) {
    queryClient.setQueryData<AccountView>(accountQuery.queryKey, (current) =>
      current ? withChanges(current, changes) : current,
    )
    saver.current ??= saveOnChange(
      async ({ changes, id }: QueuedChange) => ({
        saved: await client.me.account.update(changes),
        id,
      }),
      {
        failure: () => handlers.current.t(`${K}.notSaved`),
        saved: ({ saved, id }) =>
          void handlers.current.applySaved(saved, id === lastChange.current),
        failed: () => void handlers.current.load(handlers.current.t(`${K}.notSaved`)),
      },
    )
    lastChange.current += 1
    saver.current({ changes, id: lastChange.current })
  }

  /** Saves the browser's zone the person never chose: a failure is only reported, never toasted. */
  async function fillZone(timeZone: string) {
    try {
      await applySaved(await client.me.account.update({ timeZone }), lastChange.current === 0)
    } catch (err) {
      reportError('[account] saving the browser time zone failed', err)
    }
  }

  const fillZoneRef = useRef(fillZone)
  useEffect(() => {
    fillZoneRef.current = fillZone
  })

  const needsZone = account?.timeZone === null
  useEffect(() => {
    if (!needsZone || zoneFilled.current) return
    zoneFilled.current = true
    const zone = browserTimeZone()
    if (zone) void fillZoneRef.current(zone)
  }, [needsZone])

  function saveName() {
    if (!account || draftName === null) return
    const trimmed = draftName.trim()
    if (trimmed === '') {
      setNameError(true)
      return
    }
    setNameError(false)
    if (trimmed !== account.name) save({ name: trimmed })
    setDraftName(null)
  }

  async function signOutEverywhere() {
    if (signingOutRef.current) return
    signingOutRef.current = true
    setSigningOut(true)
    try {
      const result = await authClient.revokeOtherSessions()
      if (result?.error) throw result.error
      toastInfo(t(`${K}.signedOut`))
      void load(t(`${K}.devicesNotLoaded`))
    } catch (err) {
      reportError('[account] signing out everywhere failed', err)
      toastError(t(`${K}.notSignedOut`))
    } finally {
      signingOutRef.current = false
      setSigningOut(false)
    }
  }

  async function deleteAccount() {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    try {
      await client.me.delete()
    } catch (err) {
      deletingRef.current = false
      setDeleting(false)
      const message = statusOf(err) === 409 ? apiMessage(err) : null
      if (!message) reportError('[account] deleting the account failed', err)
      toastError(message ?? t(`${K}.notDeleted`))
      return
    }
    await authClient.signOut().catch(() => undefined)
    setConfirming(false)
    toastInfo(t(`${K}.deleted`))
    me.signedOut()
    void navigate({ to: '/signin' })
  }

  const zones =
    account?.timeZone && !TIME_ZONES.some((z) => z.zone === account.timeZone)
      ? [...TIME_ZONES, { zone: account.timeZone, key: '' }]
      : TIME_ZONES

  return (
    <SettingsSectionLayout id="account" title={t(`${K}.title`)}>
      {account ? (
        <>
          <Card>
            <CardContent className="flex items-start gap-4">
              <Avatar className="size-12">
                <AvatarFallback>{initialOf(displayName(account))}</AvatarFallback>
              </Avatar>
              <Field data-invalid={nameError || undefined} className="flex-1">
                <FieldLabel htmlFor="account-name">{t(`${K}.yourName`)}</FieldLabel>
                <Input
                  id="account-name"
                  autoComplete="name"
                  value={draftName ?? displayName(account)}
                  aria-invalid={nameError || undefined}
                  onChange={(event) => {
                    setDraftName(event.target.value)
                    setNameError(false)
                  }}
                  onBlur={saveName}
                />
                {nameError ? <FieldError>{t(`${K}.enterName`)}</FieldError> : null}
              </Field>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            <SettingsHeading>{t(`${K}.signIn`)}</SettingsHeading>
            <SettingsCard>
              <SettingRow label={t(`${K}.email`)}>{account.email}</SettingRow>
              <SettingRow label={t(`${K}.signInWith`)}>
                {t(
                  account.signInWith === 'google'
                    ? `${K}.signInGoogle`
                    : account.signInWith === 'microsoft'
                      ? `${K}.signInMicrosoft`
                      : `${K}.signInEmail`,
                )}
              </SettingRow>
              <SettingRow
                label={t(`${K}.devices`)}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={signingOut}
                    onClick={() => void signOutEverywhere()}
                  >
                    {t(`${K}.signOutEverywhere`)}
                  </Button>
                }
              >
                {devicesLine(account.devices, t, i18n.language)}
              </SettingRow>
            </SettingsCard>
          </div>

          <div className="flex flex-col gap-2">
            <SettingsHeading>{t(`${K}.preferences`)}</SettingsHeading>
            <SettingsCard>
              <SettingRow label={<span id="account-language">{t(`${K}.language`)}</span>}>
                <Select
                  value={account.language}
                  onValueChange={(language) => {
                    if (isLanguage(language)) save({ language })
                  }}
                >
                  <SelectTrigger aria-labelledby="account-language" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(LANGUAGE_NAMES) as Language[]).map((language) => (
                      <SelectItem key={language} value={language}>
                        {LANGUAGE_NAMES[language]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow label={<span id="account-time-zone">{t(`${K}.timeZone`)}</span>}>
                <Select
                  value={account.timeZone ?? ''}
                  onValueChange={(timeZone) => save({ timeZone })}
                >
                  <SelectTrigger aria-labelledby="account-time-zone" className="w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map(({ zone, key }) => (
                      <SelectItem key={zone} value={zone}>
                        {key ? t(`${K}.${key}`) : zone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            </SettingsCard>
          </div>

          <div className="flex flex-col gap-2">
            <SettingsHeading>{t(`${K}.emails`)}</SettingsHeading>
            <SettingsCard>
              <SettingRow
                label={
                  <label htmlFor="account-product-news" className="flex flex-col">
                    <span className="text-foreground">{t(`${K}.productNews`)}</span>
                    <span>{t(`${K}.productNewsHint`)}</span>
                  </label>
                }
                action={
                  <Switch
                    id="account-product-news"
                    checked={account.emails.productNews}
                    onCheckedChange={(productNews) => save({ emails: { productNews } })}
                  />
                }
              />
            </SettingsCard>
          </div>

          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle>{t(`${K}.deleteAccount`)}</CardTitle>
              {me.isOwner ? (
                <CardDescription>
                  {t(`${K}.ownerDeleteFirst`)}{' '}
                  <Button variant="link" className="h-auto p-0" onClick={() => open('security')}>
                    {t(`${K}.securityAndData`)}
                  </Button>
                  {t(`${K}.ownerDeleteFirstEnd`)}
                </CardDescription>
              ) : (
                <CardDescription>{t(`${K}.cannotBeUndone`)}</CardDescription>
              )}
            </CardHeader>
            {me.isOwner ? null : (
              <CardContent>
                <Button variant="destructive" onClick={() => setConfirming(true)}>
                  {t(`${K}.delete`)}
                </Button>
              </CardContent>
            )}
          </Card>
          <ConfirmDeleteDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={t(`${K}.confirmTitle`)}
            confirmLabel={t(`${K}.deleteAccount`)}
            pending={deleting}
            onConfirm={() => void deleteAccount()}
          />
        </>
      ) : null}
    </SettingsSectionLayout>
  )
}
