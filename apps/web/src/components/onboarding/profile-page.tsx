import { createOrganizationSchema } from '@arrakit/contract'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { PRIVACY_URL, TERMS_URL } from '#/config'
import { type ChoiceSearch, appLanding, checkoutChoice } from '#/lib/checkout-choice'
import { useCurrentUser } from '#/lib/current-user'
import { useClearingForm } from '#/lib/form'
import { notify } from '#/lib/notify'
import { client } from '#/lib/orpc'
import { useApiMutation } from '#/lib/use-api-mutation'

const profileForm = z.object({
  personName: createOrganizationSchema.shape.personName.unwrap(),
  organization: createOrganizationSchema.shape.name,
  termsAccepted: z.boolean(),
})

type ProfileTarget = ReturnType<typeof appLanding>

type ProfileStep = { name: string; personName: string } | 'skip'

/** A step whose answer was lost still counts once the person has an organization. */
async function save(step: ProfileStep): Promise<void> {
  try {
    if (step === 'skip') await client.organizations.skip()
    else await client.organizations.create({ ...step, termsAccepted: true })
  } catch (err) {
    const saved = await client.me.get().then(
      (me) => me.organization !== null,
      () => false,
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
  const me = useCurrentUser()
  const form = useClearingForm({
    resolver: zodResolver(profileForm),
    defaultValues: { personName: '', organization: '', termsAccepted: false },
  })
  const termsAccepted = useWatch({ control: form.control, name: 'termsAccepted' })
  const step = useApiMutation({
    mutationKey: ['profile'],
    mutationFn: save,
    onSuccess: async () => {
      await me.refresh()
      onDone(appLanding(checkoutChoice(search)))
    },
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
