import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { nameForm, useClearingForm } from '#/lib/form'
import { notify } from '#/lib/notify'
import { createOrganization, reloadForOrganization } from '#/lib/organization-queries'
import { useApiMutation } from '#/lib/use-api-mutation'

const K = 'createOrganization'

export function CreateOrganizationDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const form = useClearingForm({
    resolver: zodResolver(nameForm(t(`${K}.enterName`))),
    defaultValues: { name: '' },
  })
  const nameError = form.formState.errors.name?.message

  const create = useApiMutation({
    mutationKey: ['org', 'create'],
    mutationFn: async ({ name }: { name: string }) => {
      const created = await createOrganization({ name })
      await reloadForOrganization(queryClient)
      return created
    },
    onSuccess: (created) => {
      form.reset()
      onOpenChange(false)
      notify.success(t(`${K}.created`, { organization: created.name }))
      void navigate({ to: '/app' })
    },
    meta: { failure: t(`${K}.notCreated`) },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`${K}.title`)}</DialogTitle>
          <DialogDescription>{t(`${K}.description`)}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          id="create-organization"
          onSubmit={(event) => void form.handleSubmit((values) => create.run(values))(event)}
        >
          <Field data-invalid={nameError ? true : undefined}>
            <FieldLabel htmlFor="create-organization-name">{t(`${K}.name`)}</FieldLabel>
            <Input
              id="create-organization-name"
              autoComplete="organization"
              aria-invalid={nameError ? true : undefined}
              {...form.register('name')}
            />
            {nameError ? <FieldError>{nameError}</FieldError> : null}
          </Field>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t(`${K}.cancel`)}</Button>
          </DialogClose>
          <Button type="submit" form="create-organization" disabled={create.isPending}>
            {t(`${K}.create`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
