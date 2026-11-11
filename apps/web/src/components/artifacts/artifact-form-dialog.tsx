import type { Artifact } from '@arrakit/contract'
import {
  ARTIFACT_FORMATS,
  ARTIFACT_TITLE_MAX,
  type ArtifactFormat,
  artifactFormatOf,
  artifactPolicyFor,
  fitsArtifact,
} from '@arrakit/plans'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { FileUp } from 'lucide-react'
import { useRef } from 'react'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

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
import { Field, FieldError, FieldGroup, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'
import { useMember } from '#/lib/current-user'
import { useClearingForm } from '#/lib/form'
import { fileSize } from '#/lib/format'
import { notify } from '#/lib/notify'
import { orpc } from '#/lib/orpc'
import { useApiMutation } from '#/lib/use-api-mutation'

import { titleOf } from './artifact-source'

const K = 'artifacts.form'

interface ArtifactFormValues {
  title: string
  format: ArtifactFormat
  content: string
}

const artifactForm = (t: TFunction, maxBytes: number, withTitle: boolean) =>
  z.object({
    title: withTitle
      ? z
          .string()
          .trim()
          .min(1, t(`${K}.enterTitle`))
          .max(ARTIFACT_TITLE_MAX, t(`${K}.titleTooLong`, { max: ARTIFACT_TITLE_MAX }))
      : z.string(),
    format: z.enum(ARTIFACT_FORMATS),
    content: z
      .string()
      .refine((content) => content.trim() !== '', t(`${K}.enterContent`))
      .refine(
        (content) => fitsArtifact(content, { maxBytes }),
        t(`${K}.tooLarge`, { size: fileSize(maxBytes) }),
      ),
  })

/**
 * Creates an artifact in a workspace, or, given `artifact`, publishes its next version. The
 * content is pasted or read from an .html or .md file.
 */
export function ArtifactFormDialog({
  open,
  onOpenChange,
  workspaceId,
  artifact,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  artifact?: Artifact
  onSaved?: (saved: Artifact) => void
}) {
  const { t } = useTranslation()
  const me = useMember()
  const queryClient = useQueryClient()
  const picker = useRef<HTMLInputElement>(null)
  const creating = artifact === undefined
  const { maxBytes } = artifactPolicyFor(me.user.plan)
  const form = useClearingForm<ArtifactFormValues>({
    resolver: zodResolver(artifactForm(t, maxBytes, creating)),
    defaultValues: { title: '', format: artifact?.format ?? 'html', content: '' },
  })
  const { errors } = form.formState

  const changeOpen = (next: boolean) => {
    if (!next) form.reset()
    onOpenChange(next)
  }

  const saved = async (result: Artifact, message: string) => {
    await queryClient.invalidateQueries({ queryKey: orpc.artifacts.key() })
    changeOpen(false)
    notify.success(message)
    onSaved?.(result)
  }
  const create = useApiMutation({
    ...orpc.artifacts.create.mutationOptions(),
    onSuccess: (result) => saved(result, t('artifacts.created', { artifact: result.title })),
    meta: { failure: t('artifacts.notCreated') },
  })
  const publish = useApiMutation({
    ...orpc.artifacts.publish.mutationOptions(),
    onSuccess: (result) =>
      saved(
        result,
        t('artifacts.published', { artifact: result.title, version: result.currentVersion }),
      ),
    meta: { failure: t('artifacts.notPublished') },
  })

  async function load(file: File) {
    const format = artifactFormatOf(file.name)
    if (!format) {
      form.setError('content', { message: t(`${K}.wrongFile`) })
      return
    }
    if (!creating && format !== artifact.format) {
      form.setError('content', { message: t(`${K}.keepFormat`) })
      return
    }
    form.setValue('content', await file.text())
    form.clearErrors('content')
    if (creating) {
      form.setValue('format', format)
      if (!form.getValues('title').trim()) form.setValue('title', titleOf(file.name))
    }
  }

  const submit = form.handleSubmit(({ title, format, content }) =>
    creating
      ? create.run({ workspaceId, title, format, content })
      : publish.run({ id: artifact.id, content }),
  )

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {creating
              ? t(`${K}.createTitle`)
              : t(`${K}.publishTitle`, { artifact: artifact.title })}
          </DialogTitle>
          <DialogDescription>
            {creating
              ? t(`${K}.createHint`)
              : t(`${K}.publishHint`, { version: artifact.currentVersion + 1 })}
          </DialogDescription>
        </DialogHeader>
        <form noValidate id="artifact-form" onSubmit={(event) => void submit(event)}>
          <FieldGroup>
            {creating ? (
              <>
                <Field data-invalid={errors.title ? true : undefined}>
                  <FieldLabel htmlFor="artifact-title">{t(`${K}.title`)}</FieldLabel>
                  <Input
                    id="artifact-title"
                    autoComplete="off"
                    aria-invalid={errors.title ? true : undefined}
                    {...form.register('title')}
                  />
                  {errors.title ? <FieldError>{errors.title.message}</FieldError> : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="artifact-format">{t(`${K}.format`)}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="format"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="artifact-format">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ARTIFACT_FORMATS.map((format) => (
                            <SelectItem key={format} value={format}>
                              {t(`artifacts.formats.${format}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </>
            ) : null}
            <Field data-invalid={errors.content ? true : undefined}>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="artifact-content">{t(`${K}.content`)}</FieldLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => picker.current?.click()}
                >
                  <FileUp />
                  {t(`${K}.fromFile`)}
                </Button>
                <input
                  ref={picker}
                  type="file"
                  accept=".html,.htm,.md,.markdown"
                  className="sr-only"
                  aria-label={t(`${K}.fromFile`)}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void load(file)
                  }}
                />
              </div>
              <Textarea
                id="artifact-content"
                rows={12}
                className="max-h-96 font-mono text-xs"
                aria-invalid={errors.content ? true : undefined}
                {...form.register('content')}
              />
              {errors.content ? <FieldError>{errors.content.message}</FieldError> : null}
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t(`${K}.cancel`)}</Button>
          </DialogClose>
          <Button
            type="submit"
            form="artifact-form"
            disabled={create.isPending || publish.isPending}
          >
            {creating ? t(`${K}.create`) : t(`${K}.publish`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
