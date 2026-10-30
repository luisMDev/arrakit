import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Card, CardContent } from '#/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { authCall } from '#/lib/auth-call'
import { authClient } from '#/lib/auth-client'
import { initialOf, useCurrentUser } from '#/lib/current-user'
import { registerClearing, useClearingForm } from '#/lib/form'
import { organizationQueries } from '#/lib/organization-queries'
import { useApiMutation } from '#/lib/use-api-mutation'

import { SettingsSectionLayout } from './settings-ui'

const K = 'settings.generalSettings'

const nameSchema = z.object({ name: z.string().trim().min(1).max(200) })

export function GeneralSection() {
  const { t } = useTranslation()
  const me = useCurrentUser()
  const queryClient = useQueryClient()
  const organization = me.user?.organization ?? null
  const form = useClearingForm({
    resolver: zodResolver(nameSchema),
    values: { name: organization?.name ?? '' },
  })
  const invalid = form.formState.errors.name !== undefined
  const editable = me.can({ organization: ['update'] })

  const rename = useApiMutation({
    mutationKey: ['org', 'update'],
    mutationFn: ({ organizationId, name }: { organizationId: string; name: string }) =>
      authCall(authClient.organization.update({ organizationId, data: { name } })),
    onSuccess: (saved) => {
      me.patch((current) =>
        current.organization
          ? { ...current, organization: { ...current.organization, name: saved.name } }
          : current,
      )
      form.reset({ name: saved.name })
      void queryClient.invalidateQueries({ queryKey: organizationQueries.list().queryKey })
    },
    onError: async () => {
      form.reset()
      await me.refresh()
    },
    meta: { failure: t(`${K}.notSaved`) },
  })

  async function saveName({ name: trimmed }: z.output<typeof nameSchema>) {
    if (!organization || !editable) return
    if (trimmed === organization.name) {
      form.reset()
      return
    }
    await rename.run({ organizationId: organization.id, name: trimmed })
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
                disabled={!editable}
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
