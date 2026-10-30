import { createOrganizationSchema } from '@arrakit/contract'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { PRIVACY_URL, TERMS_URL } from '#/config'
import { type CheckoutChoice, type ChoiceSearch, checkoutChoice } from '#/lib/checkout-choice'
import { orpc } from '#/lib/orpc'

import { useOnboardingApi } from './onboarding-api'

const profileForm = z.object({
  personName: createOrganizationSchema.shape.personName.unwrap(),
  organization: createOrganizationSchema.shape.name,
  termsAccepted: z.boolean().refine((accepted) => accepted),
})

export type ProfileTarget = { to: '/app' } | { to: '/app/checkout'; search: CheckoutChoice }

export function profileTarget(search: ChoiceSearch): ProfileTarget {
  const choice = checkoutChoice(search)
  return choice ? { to: '/app/checkout', search: choice } : { to: '/app' }
}

export function ProfilePage({
  search,
  onDone,
}: {
  search: ChoiceSearch
  onDone: (target: ProfileTarget) => void
}) {
  const { t } = useTranslation()
  const api = useOnboardingApi()
  const queryClient = useQueryClient()
  const form = useForm({
    resolver: zodResolver(profileForm),
    defaultValues: { personName: '', organization: '', termsAccepted: false },
  })
  const termsAccepted = useWatch({ control: form.control, name: 'termsAccepted' })
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)

  async function settle(request: () => Promise<unknown>, failure: string) {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    let saved = true
    try {
      await request()
    } catch {
      saved = await api.currentOrganization().then(
        (current) => current !== null,
        () => false,
      )
    }
    if (saved) {
      queryClient.removeQueries({ queryKey: orpc.me.get.queryOptions().queryKey })
      onDone(profileTarget(search))
      return
    }
    pendingRef.current = false
    setPending(false)
    toast.error(t(failure))
  }

  function next({ personName, organization }: z.output<typeof profileForm>) {
    return settle(
      () => api.create({ name: organization, personName }),
      'profile.organizationNotSaved',
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl grow flex-col justify-center gap-8 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {t('profile.titleStart')}{' '}
        <span className="text-muted-foreground">{t('profile.titleEnd')}</span>
      </h1>
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => void form.handleSubmit(next)(e)}
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
          <Button type="submit" disabled={!termsAccepted || pending}>
            {t('profile.next')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => void settle(() => api.skip(), 'profile.notSkipped')}
          >
            {t('profile.skip')}
          </Button>
        </div>
      </form>
    </main>
  )
}
