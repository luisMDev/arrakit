import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Controller, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { PRIVACY_URL, TERMS_URL } from '#/config'
import { type ChoiceSearch, appLanding, checkoutChoice } from '#/lib/checkout-choice'
import { personNameField, useClearingForm } from '#/lib/form'
import { notify } from '#/lib/notify'
import { authCall } from '#/lib/auth-call'
import { authClient } from '#/lib/auth-client'
import { client } from '#/lib/orpc'
import { createOrganization, reloadForOrganization } from '#/lib/organization-queries'
import { useApiMutation } from '#/lib/use-api-mutation'

const profileForm = z.object({
  personName: z.string().trim().pipe(z.literal('').or(personNameField)),
  organization: z.string().trim().max(200),
  termsAccepted: z.boolean(),
})

type ProfileTarget = ReturnType<typeof appLanding>

type ProfileStep = { name: string; personName: string } | 'skip'

/**
 * Next names the person (when typed) and creates the organization with the terms accepted; Skip
 * creates one named after the person. A step whose answer was lost still counts once they have one.
 */
async function create(step: ProfileStep): Promise<void> {
  try {
    if (step === 'skip') {
      await createOrganization({ name: '' })
      return
    }
    if (step.personName) await authCall(authClient.updateUser({ name: step.personName }))
    await createOrganization({ name: step.name, termsAccepted: true })
  } catch (err) {
    const saved = await client.me.get().then(
      (me) => me.organization?.id,
      () => undefined,
    )
    if (!saved) throw err
  }
}

export function ProfilePage({
  search,
  onDone,
}: {
  search: ChoiceSearch
  onDone: (target: ProfileTarget) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useClearingForm({
    resolver: zodResolver(profileForm),
    defaultValues: { personName: '', organization: '', termsAccepted: false },
  })
  const termsAccepted = useWatch({ control: form.control, name: 'termsAccepted' })
  const step = useApiMutation({
    mutationKey: ['profile'],
    mutationFn: async (variables: ProfileStep) => {
      await create(variables)
      await reloadForOrganization(queryClient)
    },
    onSuccess: () => onDone(appLanding(checkoutChoice(search))),
    meta: {
      failure: (variables: ProfileStep) =>
        t(variables === 'skip' ? 'profile.notSkipped' : 'profile.organizationNotSaved'),
    },
  })

  function next({ personName, organization }: z.output<typeof profileForm>) {
    return step.run({ name: organization, personName })
  }

  const notSaved = () => notify.error(t('profile.organizationNotSaved'))

  return (
    <main className="mx-auto flex w-full max-w-2xl grow flex-col justify-center gap-8 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {t('profile.titleStart')}{' '}
        <span className="text-muted-foreground">{t('profile.titleEnd')}</span>
      </h1>
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => void form.handleSubmit(next, notSaved)(e)}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="profile-name">{t('profile.yourName')}</FieldLabel>
            <Input id="profile-name" autoComplete="name" {...form.register('personName')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-organization">{t('profile.organization')}</FieldLabel>
            <Input
              id="profile-organization"
              autoComplete="organization"
              {...form.register('organization')}
            />
          </Field>
        </div>
        <div className="flex items-start gap-3">
          <Controller
            control={form.control}
            name="termsAccepted"
            render={({ field }) => (
              <Checkbox
                id="profile-terms"
                ref={field.ref}
                name={field.name}
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
              />
            )}
          />
          <p className="text-sm leading-tight">
            <label htmlFor="profile-terms">{t('profile.agreeTo')}</label>{' '}
            <Button asChild variant="link" className="h-auto p-0">
              <a href={TERMS_URL} target="_blank" rel="noopener">
                {t('profile.terms')}
              </a>
            </Button>{' '}
            {t('profile.andThe')}{' '}
            <Button asChild variant="link" className="h-auto p-0">
              <a href={PRIVACY_URL} target="_blank" rel="noopener">
                {t('profile.privacyPolicy')}
              </a>
            </Button>
            {t('profile.agreeEnd')}
          </p>
        </div>
        <div className="flex gap-3">
          <Button type="submit" disabled={!termsAccepted || step.busy}>
            {t('profile.next')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={step.busy}
            onClick={() => void step.run('skip')}
          >
            {t('profile.skip')}
          </Button>
        </div>
      </form>
    </main>
  )
}
