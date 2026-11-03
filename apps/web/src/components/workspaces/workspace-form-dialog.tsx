import {
  WORKSPACE_DESCRIPTION_MAX,
  WORKSPACE_NAME_MAX,
  type Workspace,
  type WorkspaceInput,
} from '@arrakit/contract'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { nameForm, useClearingForm } from '#/lib/form'
import { notify } from '#/lib/notify'
import { orpc } from '#/lib/orpc'
import { useApiMutation } from '#/lib/use-api-mutation'

const K = 'workspaces.form'

const workspaceForm = (t: TFunction) =>
  nameForm(t(`${K}.enterName`), {
    max: WORKSPACE_NAME_MAX,
    tooLong: t(`${K}.nameTooLong`, { max: WORKSPACE_NAME_MAX }),
  }).extend({
    description: z
      .string()
      .trim()
      .max(
        WORKSPACE_DESCRIPTION_MAX,
        t(`${K}.descriptionTooLong`, { max: WORKSPACE_DESCRIPTION_MAX }),
      ),
  })

const EMPTY: WorkspaceInput = { name: '', description: '' }

/** Creates a workspace, or edits `workspace` when given. */
export function WorkspaceFormDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace?: Workspace
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useClearingForm<WorkspaceInput>({
    resolver: zodResolver(workspaceForm(t)),
    values: workspace ? { name: workspace.name, description: workspace.description } : EMPTY,
  })
  const { errors } = form.formState
  const formId = workspace ? `workspace-${workspace.id}` : 'new-workspace'

  const changeOpen = (next: boolean) => {
    if (!next) form.reset()
    onOpenChange(next)
  }

  const done = async (saved: Workspace, message: string) => {
    await queryClient.invalidateQueries({ queryKey: orpc.workspaces.list.key() })
    changeOpen(false)
    notify.success(t(message, { workspace: saved.name }))
  }

  const create = useApiMutation({
    ...orpc.workspaces.create.mutationOptions(),
    onSuccess: (saved) => done(saved, 'workspaces.created'),
    meta: { failure: t('workspaces.notCreated') },
  })
  const update = useApiMutation({
    ...orpc.workspaces.update.mutationOptions(),
    onSuccess: (saved) => done(saved, 'workspaces.saved'),
    meta: { failure: t('workspaces.notSaved') },
  })
  const pending = create.isPending || update.isPending

  const save = (values: WorkspaceInput) =>
    workspace ? update.run({ id: workspace.id, ...values }) : create.run(values)

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(workspace ? `${K}.editTitle` : `${K}.createTitle`)}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(event) => void form.handleSubmit(save)(event)}
        >
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor={`${formId}-name`}>{t(`${K}.name`)}</FieldLabel>
            <Input
              id={`${formId}-name`}
              autoComplete="off"
              aria-invalid={errors.name ? true : undefined}
              {...form.register('name')}
            />
            {errors.name ? <FieldError>{errors.name.message}</FieldError> : null}
          </Field>
          <Field data-invalid={errors.description ? true : undefined}>
            <FieldLabel htmlFor={`${formId}-description`}>{t(`${K}.description`)}</FieldLabel>
            <Textarea
              id={`${formId}-description`}
              aria-invalid={errors.description ? true : undefined}
              {...form.register('description')}
            />
            {errors.description ? (
              <FieldError>{errors.description.message}</FieldError>
            ) : (
              <FieldDescription>{t(`${K}.descriptionHint`)}</FieldDescription>
            )}
          </Field>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t(`${K}.cancel`)}</Button>
          </DialogClose>
          <Button type="submit" form={formId} disabled={pending}>
            {t(workspace ? `${K}.save` : `${K}.create`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
