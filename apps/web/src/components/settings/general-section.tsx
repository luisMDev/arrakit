import { updateOrganizationSchema } from '@arrakit/contract'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Card, CardContent } from '#/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { reportError } from '#/lib/api-errors'
import { initialOf, useCurrentUser } from '#/lib/current-user'
import { registerClearing, useClearingForm } from '#/lib/form'
import { notify } from '#/lib/notify'
import { client, orpc } from '#/lib/orpc'

import { SettingsSectionLayout } from './settings-ui'

const K = 'settings.generalSettings'

const nameSchema = z.object({ name: updateOrganizationSchema.shape.name.unwrap() })

export function GeneralSection() {
  const { t } = useTranslation()
  const me = useCurrentUser()
  const organization = me.user?.organization ?? null
  const form = useClearingForm({
    resolver: zodResolver(nameSchema),
    values: { name: organization?.name ?? '' },
  })
  const invalid = form.formState.errors.name !== undefined
  const queryClient = useQueryClient()

  /** The organization as the API holds it now; a failure says `failure` and keeps what shows. */
  async function load(failure: string) {
    try {
      await queryClient.fetchQuery({ ...orpc.me.get.queryOptions(), staleTime: 0 })
    } catch (err) {
      reportError('[general] loading the organization failed', err)
      notify.error(failure)
    }
  }

  const loadOnOpen = useRef(() => load(t(`${K}.notLoaded`)))
  useEffect(() => {
    void loadOnOpen.current()
  }, [])

  async function saveName({ name: trimmed }: z.output<typeof nameSchema>) {
    if (!organization || !me.isAdmin) return
    if (trimmed === organization.name) {
      form.reset()
      return
    }
    try {
      const saved = await client.organizations.update({ name: trimmed })
      me.patch((current) =>
        current.organization
          ? { ...current, organization: { ...current.organization, name: saved.name } }
          : current,
      )
      form.reset({ name: saved.name })
    } catch (err) {
      reportError('[general] renaming the organization failed', err)
      notify.error(t(`${K}.notSaved`))
      form.reset()
      await load(t(`${K}.notSaved`))
    }
  }

  const nameField = registerClearing(form, 'name')

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
                disabled={!me.isAdmin}
                aria-invalid={invalid || undefined}
                {...nameField}
                onBlur={(event) => {
                  void nameField.onBlur(event)
                  if (form.getFieldState('name').isDirty) void form.handleSubmit(saveName)()
                }}
              />
              <FieldDescription>{t(`${K}.slug`, { slug: organization.slug })}</FieldDescription>
            </Field>
          </CardContent>
        </Card>
      ) : null}
    </SettingsSectionLayout>
  )
}
