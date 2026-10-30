import { type AccountView, accountUpdateSchema } from '@arrakit/contract'
import { zodResolver } from '@hookform/resolvers/zod'
import { personName } from '@arrakit/address'
import {
  type UseMutationOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

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
import { authClient } from '#/lib/auth-client'
import { initialOf, useCurrentUser } from '#/lib/current-user'
import { listing } from '#/lib/format'
import { registerClearing, useClearingForm } from '#/lib/form'
import { notify } from '#/lib/notify'
import { client, orpc } from '#/lib/orpc'
import { useApiMutation } from '#/lib/use-api-mutation'

import { ConfirmDeleteDialog } from './confirm-delete-dialog'
import { SettingRow, SettingsCard, SettingsHeading, SettingsSectionLayout } from './settings-ui'

const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', es: 'Español' }

const TIME_ZONES: { zone: string; key: string }[] = [
  { zone: 'Europe/Madrid', key: 'zoneMadrid' },
  { zone: 'Europe/London', key: 'zoneLondon' },
  { zone: 'America/New_York', key: 'zoneNewYork' },
  { zone: 'America/Chicago', key: 'zoneChicago' },
  { zone: 'America/Los_Angeles', key: 'zoneLosAngeles' },
  { zone: 'America/Santiago', key: 'zoneSantiago' },
]

const K = 'settings.accountSettings'

const SAVE_KEY = ['account']

const nameSchema = z.object({ name: accountUpdateSchema.shape.name.unwrap() })

type AccountUpdate = Parameters<typeof client.me.account.update>[0]

type Translate = (key: string, params?: Record<string, unknown>) => string

/** "This Mac and an iPhone": the current device first, the others with their article. */
export function devicesLine(devices: string[], t: Translate): string {
  if (devices.length === 0) return t(`${K}.noDevice`)
  const [first, ...others] = devices as [string, ...string[]]
  const parts = [
    t(`${K}.thisDevice`, { device: first }),
    ...others.map((device) =>
      t(/^[aeiou]/i.test(device) ? `${K}.anDevice` : `${K}.aDevice`, { device }),
    ),
  ]
  return listing(parts)
}

function withChanges(account: AccountView, changes: AccountUpdate): AccountView {
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

export function AccountSection() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useCurrentUser()
  const { queryKey } = orpc.me.account.get.queryOptions()
  const { data: account } = useQuery(
    orpc.me.account.get.queryOptions({ meta: { failure: t(`${K}.notLoaded`) } }),
  )
  const form = useClearingForm({
    resolver: zodResolver(nameSchema),
    values: { name: account ? personName(account.name, account.email) : '' },
  })
  const nameError = form.formState.errors.name !== undefined
  const [confirming, setConfirming] = useState(false)

  const update: UseMutationOptions<AccountView, Error, AccountUpdate> = {
    mutationKey: SAVE_KEY,
    mutationFn: (changes) => client.me.account.update(changes),
    scope: { id: 'account' },
    onMutate: async (changes) => {
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData<AccountView>(queryKey, (current) =>
        current ? withChanges(current, changes) : current,
      )
    },
    onSuccess: async (saved) => {
      if (queryClient.isMutating({ mutationKey: SAVE_KEY }) === 1) {
        queryClient.setQueryData(queryKey, saved)
      }
      me.patch((current) => ({ ...current, name: saved.name, language: saved.language }))
      if (isLanguage(saved.language)) await loadLanguage(saved.language)
    },
    onError: () => queryClient.invalidateQueries({ queryKey }),
  }
  const saving = useApiMutation({ ...update, meta: { failure: t(`${K}.notSaved`) } })
  const save = (changes: AccountUpdate) => saving.mutate(changes)
  const fillZone = useMutation(update)

  const zoneFilled = useRef(false)
  const needsZone = account?.timeZone === null
  const { mutate: saveZone } = fillZone
  useEffect(() => {
    if (!needsZone || zoneFilled.current) return
    zoneFilled.current = true
    const zone = browserTimeZone()
    if (zone) saveZone({ timeZone: zone })
  }, [needsZone, saveZone])

  function saveName({ name: trimmed }: z.output<typeof nameSchema>) {
    if (!account) return
    if (trimmed !== account.name) save({ name: trimmed })
    form.reset({ name: trimmed })
  }

  const nameField = registerClearing(form, 'name')

  const signOutEverywhere = useApiMutation({
    mutationFn: async () => {
      const result = await authClient.revokeOtherSessions()
      if (result?.error) throw result.error
    },
    onSuccess: () => {
      notify.success(t(`${K}.signedOut`))
      void queryClient.invalidateQueries({ queryKey })
    },
    meta: { failure: t(`${K}.notSignedOut`) },
  })

  const deleteAccount = useApiMutation({
    ...orpc.me.delete.mutationOptions(),
    onSuccess: async () => {
      await authClient.signOut().catch(() => undefined)
      setConfirming(false)
      notify.success(t(`${K}.deleted`))
      me.signedOut()
      void navigate({ to: '/signin' })
    },
    meta: { failure: t(`${K}.notDeleted`) },
  })

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
                <AvatarFallback>
                  {initialOf(personName(account.name, account.email))}
                </AvatarFallback>
              </Avatar>
              <Field data-invalid={nameError || undefined} className="flex-1">
                <FieldLabel htmlFor="account-name">{t(`${K}.yourName`)}</FieldLabel>
                <Input
                  id="account-name"
                  autoComplete="name"
                  aria-invalid={nameError || undefined}
                  {...nameField}
                  onBlur={(event) => {
                    void nameField.onBlur(event)
                    if (form.getFieldState('name').isDirty) void form.handleSubmit(saveName)()
                  }}
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
                    disabled={signOutEverywhere.isPending}
                    onClick={() => void signOutEverywhere.run()}
                  >
                    {t(`${K}.signOutEverywhere`)}
                  </Button>
                }
              >
                {devicesLine(account.devices, t)}
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
                  <Button asChild variant="link" className="h-auto p-0">
                    <Link to="/app/settings" search={{ section: 'security' }}>
                      {t(`${K}.securityAndData`)}
                    </Link>
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
            pending={deleteAccount.isPending}
            onConfirm={() => void deleteAccount.run()}
          />
        </>
      ) : null}
    </SettingsSectionLayout>
  )
}
