import type { Artifact } from '@arrakit/contract'
import { ARTIFACT_TITLE_MAX } from '@arrakit/plans'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { nameForm, useClearingForm } from '#/lib/form'
import { notify } from '#/lib/notify'
import { orpc } from '#/lib/orpc'
import { useApiMutation } from '#/lib/use-api-mutation'

const K = 'artifacts.renameForm'

/** Renames `artifact`; closed while there is none. */
export function RenameArtifactDialog({
  artifact,
  onClose,
}: {
  artifact?: Artifact
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useClearingForm<{ name: string }>({
    resolver: zodResolver(
      nameForm(t(`${K}.enterTitle`), {
        max: ARTIFACT_TITLE_MAX,
        tooLong: t('artifacts.form.titleTooLong', { max: ARTIFACT_TITLE_MAX }),
      }),
    ),
    values: { name: artifact?.title ?? '' },
  })
  const { errors } = form.formState

  const changeOpen = (next: boolean) => {
    if (next) return
    form.reset()
    onClose()
  }

  const rename = useApiMutation({
    ...orpc.artifacts.rename.mutationOptions(),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: orpc.artifacts.key() })
      changeOpen(false)
      notify.success(t('artifacts.renamed', { artifact: saved.title }))
    },
    meta: { failure: t('artifacts.notRenamed') },
  })

  return (
    <Dialog open={artifact !== undefined} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`${K}.title`)}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          id="rename-artifact"
          onSubmit={(event) =>
            void form.handleSubmit(({ name }) =>
              artifact ? rename.run({ id: artifact.id, title: name }) : undefined,
            )(event)
          }
        >
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="rename-artifact-title">{t(`${K}.name`)}</FieldLabel>
            <Input
              id="rename-artifact-title"
              autoComplete="off"
              aria-invalid={errors.name ? true : undefined}
              {...form.register('name')}
            />
            {errors.name ? <FieldError>{errors.name.message}</FieldError> : null}
          </Field>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t(`${K}.cancel`)}</Button>
          </DialogClose>
          <Button type="submit" form="rename-artifact" disabled={rename.isPending}>
            {t(`${K}.save`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
