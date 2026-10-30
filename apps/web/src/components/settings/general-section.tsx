import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Card, CardContent } from '#/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { reportError, toastError } from '#/lib/api-errors'
import { initialOf, useCurrentUser } from '#/lib/current-user'
import { client, orpc } from '#/lib/orpc'

import { SettingsSectionLayout } from './settings-ui'

const K = 'settings.generalSettings'

export function GeneralSection() {
  const { t } = useTranslation()
  const me = useCurrentUser()
  const organization = me.user?.organization ?? null
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const queryClient = useQueryClient()

  /** The organization as the API holds it now; a failure says `failure` and keeps what shows. */
  async function load(failure: string) {
    try {
      await queryClient.fetchQuery({ ...orpc.me.get.queryOptions(), staleTime: 0 })
    } catch (err) {
      reportError('[general] loading the organization failed', err)
      toastError(failure)
    }
  }

  const loadOnOpen = useRef(() => load(t(`${K}.notLoaded`)))
  useEffect(() => {
    void loadOnOpen.current()
  }, [])

  async function saveName() {
    if (!organization || !me.isAdmin || draft === null) return
    const trimmed = draft.trim()
    if (trimmed === '') {
      setInvalid(true)
      return
    }
    if (trimmed === organization.name) {
      setDraft(null)
      return
    }
    try {
      const saved = await client.organizations.update({ name: trimmed })
      me.patch((current) =>
        current.organization
          ? { ...current, organization: { ...current.organization, name: saved.name } }
          : current,
      )
      setDraft(null)
    } catch (err) {
      reportError('[general] renaming the organization failed', err)
      toastError(t(`${K}.notSaved`))
      setDraft(null)
      await load(t(`${K}.notSaved`))
    }
  }

  return (
    <SettingsSectionLayout id="general" title={t(`${K}.title`)}>
      {organization ? (
        <Card>
          <CardContent className="flex items-start gap-4">
            <div
              aria-hidden
              className="bg-muted flex size-12 shrink-0 items-center justify-center rounded-md text-lg font-semibold"
            >
              {initialOf(organization.name)}
            </div>
            <Field data-invalid={invalid || undefined} className="flex-1">
              <FieldLabel htmlFor="organization-name">{t(`${K}.organizationName`)}</FieldLabel>
              <Input
                id="organization-name"
                autoComplete="organization"
                value={draft ?? organization.name}
                disabled={!me.isAdmin}
                aria-invalid={invalid || undefined}
                onChange={(event) => {
                  setDraft(event.target.value)
                  setInvalid(false)
                }}
                onBlur={() => void saveName()}
              />
              <FieldDescription>{t(`${K}.slug`, { slug: organization.slug })}</FieldDescription>
            </Field>
          </CardContent>
        </Card>
      ) : null}
    </SettingsSectionLayout>
  )
}
