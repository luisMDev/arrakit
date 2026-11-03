import type { FileView } from '@arrakit/contract'
import { FILE_NAME_MAX, fileExtension } from '@arrakit/plans'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
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

const K = 'files.renameForm'

const renameForm = (t: TFunction, current: string) =>
  nameForm(t(`${K}.enterName`), {
    max: FILE_NAME_MAX,
    tooLong: t(`${K}.nameTooLong`, { max: FILE_NAME_MAX }),
  }).refine(({ name }) => fileExtension(name) === fileExtension(current), {
    path: ['name'],
    message: t(`${K}.keepType`, { extension: fileExtension(current) ?? '' }),
  })

/** Renames `file`; closed while there is none. */
export function RenameFileDialog({ file, onClose }: { file?: FileView; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useClearingForm<{ name: string }>({
    resolver: zodResolver(renameForm(t, file?.name ?? '')),
    values: { name: file?.name ?? '' },
  })
  const { errors } = form.formState

  const changeOpen = (next: boolean) => {
    if (next) return
    form.reset()
    onClose()
  }

  const rename = useApiMutation({
    ...orpc.files.rename.mutationOptions(),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: orpc.files.list.key() })
      changeOpen(false)
      notify.success(t('files.renamed', { file: saved.name }))
    },
    meta: { failure: t('files.notRenamed') },
  })

  return (
    <Dialog open={file !== undefined} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`${K}.title`)}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          id="rename-file"
          onSubmit={(event) =>
            void form.handleSubmit(({ name }) =>
              file ? rename.run({ id: file.id, name }) : undefined,
            )(event)
          }
        >
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="rename-file-name">{t(`${K}.name`)}</FieldLabel>
            <Input
              id="rename-file-name"
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
          <Button type="submit" form="rename-file" disabled={rename.isPending}>
            {t(`${K}.save`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
