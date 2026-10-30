import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Field, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { type CheckoutChoice, type ChoiceSearch, checkoutChoice } from '#/lib/checkout-choice'
import { orpc } from '#/lib/orpc'

import { useOnboardingApi } from './onboarding-api'

export type ProfileTarget = { to: '/app' } | { to: '/app/checkout'; search: CheckoutChoice }

export function profileTarget(search: ChoiceSearch): ProfileTarget {
  const choice = checkoutChoice(search)
  return choice ? { to: '/app/checkout', search: choice } : { to: '/app' }
}

type LegalText = 'terms' | 'privacy'

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
  const [personName, setPersonName] = useState('')
  const [organization, setOrganization] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [legalOpen, setLegalOpen] = useState(false)
  const [legal, setLegal] = useState<LegalText>('terms')

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

  function next(event: FormEvent) {
    event.preventDefault()
    if (!termsAccepted) return
    void settle(
      () => api.create({ name: organization.trim(), personName: personName.trim() }),
      'profile.organizationNotSaved',
    )
  }

  function openLegal(text: LegalText) {
    setLegal(text)
    setLegalOpen(true)
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl grow flex-col justify-center gap-8 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {t('profile.titleStart')}{' '}
        <span className="text-muted-foreground">{t('profile.titleEnd')}</span>
      </h1>
      <form noValidate className="flex flex-col gap-6" onSubmit={next}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="profile-name">{t('profile.yourName')}</FieldLabel>
            <Input
              id="profile-name"
              autoComplete="name"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-organization">{t('profile.organization')}</FieldLabel>
            <Input
              id="profile-organization"
              autoComplete="organization"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="profile-terms"
            checked={termsAccepted}
            onCheckedChange={(checked) => setTermsAccepted(checked === true)}
          />
          <p className="text-sm leading-tight">
            <label htmlFor="profile-terms">{t('profile.agreeTo')}</label>{' '}
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={() => openLegal('terms')}
            >
              {t('profile.terms')}
            </Button>{' '}
            {t('profile.andThe')}{' '}
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={() => openLegal('privacy')}
            >
              {t('profile.privacyPolicy')}
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
      <Dialog open={legalOpen} onOpenChange={setLegalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(legal === 'terms' ? 'profile.terms' : 'profile.privacyPolicy')}
            </DialogTitle>
            <DialogDescription>
              {t(legal === 'terms' ? 'profile.termsBody' : 'profile.privacyBody')}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </main>
  )
}
