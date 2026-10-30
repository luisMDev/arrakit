import { type Permissions, type Resource, statements } from '@arrakit/auth/permissions'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Separator } from '#/components/ui/separator'
import { authCall } from '#/lib/auth-call'
import { authClient } from '#/lib/auth-client'
import { roleLabel, useMember } from '#/lib/current-user'
import { registerClearing, useClearingForm } from '#/lib/form'
import { notify } from '#/lib/notify'
import { type CustomRole, organizationQueries } from '#/lib/organization-queries'
import { useApiMutation } from '#/lib/use-api-mutation'

import { ConfirmDialog } from './confirm-dialog'
import { SettingsSectionLayout } from './settings-ui'

const K = 'settings.rolesSettings'

const org = authClient.organization

const RESOURCES = Object.keys(statements) as Resource[]

type Grid = Record<string, string[]>

/** The permissions ticked, without the resources left empty. */
const picked = (grid: Grid): Grid =>
  Object.fromEntries(Object.entries(grid).filter(([, actions]) => actions.length > 0))

const countOf = (permission: Permissions | Grid) =>
  Object.values(permission).reduce((total, actions) => total + (actions?.length ?? 0), 0)

function roleForm(t: (key: string) => string) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t(`${K}.enterName`))
      .max(100)
      .refine((name) => !name.includes(','), t(`${K}.noComma`)),
    permission: z
      .record(z.string(), z.array(z.string()))
      .refine((grid) => countOf(picked(grid)) > 0, t(`${K}.pickPermission`)),
  })
}

type RoleValues = z.output<ReturnType<typeof roleForm>>

export function RolesSection() {
  const { t } = useTranslation()
  const me = useMember()
  const queryClient = useQueryClient()
  const organizationId = me.organization.id
  const rolesQuery = organizationQueries.roles(organizationId)
  const roles = useQuery({
    ...rolesQuery,
    enabled: me.can({ ac: ['read'] }),
    meta: { failure: t(`${K}.notLoaded`) },
  })
  const [editing, setEditing] = useState<CustomRole | 'new' | null>(null)
  const [deleting, setDeleting] = useState<CustomRole | null>(null)

  const remove = useApiMutation({
    mutationKey: ['org', 'deleteRole'],
    mutationFn: (role: CustomRole) => authCall(org.deleteRole({ roleId: role.id, organizationId })),
    onSuccess: async (_, role) => {
      setDeleting(null)
      await queryClient.invalidateQueries({ queryKey: rolesQuery.queryKey })
      notify.success(t(`${K}.deleted`, { role: role.role }))
    },
    meta: { failure: t(`${K}.notDeleted`) },
  })

  const canCreate = me.can({ ac: ['create'] })
  const canUpdate = me.can({ ac: ['update'] })
  const canDelete = me.can({ ac: ['delete'] })

  return (
    <SettingsSectionLayout
      id="roles"
      title={t(`${K}.title`)}
      aside={
        canCreate ? <Button onClick={() => setEditing('new')}>{t(`${K}.newRole`)}</Button> : null
      }
    >
      <p className="text-muted-foreground text-sm">{t(`${K}.hint`)}</p>
      <Card>
        <CardHeader>
          <CardTitle>{t(`${K}.builtIn`)}</CardTitle>
          <CardDescription>{t(`${K}.builtInHint`)}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{roleLabel('owner,admin,member')}</p>
        </CardContent>
      </Card>
      <Card className="py-2">
        <CardContent>
          <ul aria-label={t(`${K}.custom`)}>
            {roles.data?.length === 0 ? (
              <li className="text-muted-foreground py-3 text-sm">{t(`${K}.empty`)}</li>
            ) : null}
            {roles.data?.map((role, index) => {
              const count = countOf(role.permission)
              return (
                <li key={role.id} data-role={role.role}>
                  {index > 0 ? <Separator /> : null}
                  <div className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{role.role}</p>
                      <p className="text-muted-foreground text-sm">
                        {t(count === 1 ? `${K}.permissionCountOne` : `${K}.permissionCountMany`, {
                          count,
                        })}
                      </p>
                    </div>
                    {canUpdate ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t(`${K}.editOf`, { role: role.role })}
                        onClick={() => setEditing(role)}
                      >
                        {t(`${K}.edit`)}
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t(`${K}.deleteOf`, { role: role.role })}
                        onClick={() => setDeleting(role)}
                      >
                        {t(`${K}.delete`)}
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
      {editing ? (
        <RoleDialog
          role={editing === 'new' ? null : editing}
          organizationId={organizationId}
          onDone={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t(`${K}.confirmDeleteTitle`, { role: deleting?.role ?? '' })}
        confirmLabel={t(`${K}.deleteOf`, { role: deleting?.role ?? '' })}
        pending={remove.isPending}
        onConfirm={() => deleting && void remove.run(deleting)}
      />
    </SettingsSectionLayout>
  )
}

function RoleDialog({
  role,
  organizationId,
  onDone,
}: {
  role: CustomRole | null
  organizationId: string
  onDone: () => void
}) {
  const { t } = useTranslation()
  const me = useMember()
  const queryClient = useQueryClient()
  const held = me.user.permissions as Grid
  const form = useClearingForm({
    resolver: zodResolver(roleForm(t)),
    defaultValues: {
      name: role?.role ?? '',
      permission: Object.fromEntries(
        Object.entries(role?.permission ?? {}).map(([resource, actions]) => [
          resource,
          [...(actions ?? [])],
        ]),
      ) as Grid,
    },
  })
  const nameError = form.formState.errors.name?.message
  const permissionError = form.formState.errors.permission?.message as string | undefined

  const save = useApiMutation({
    mutationKey: ['org', role ? 'updateRole' : 'createRole'],
    mutationFn: ({ name, permission }: RoleValues) =>
      role
        ? authCall(
            org.updateRole({
              roleId: role.id,
              organizationId,
              data: { permission: picked(permission) },
            }),
          )
        : authCall(org.createRole({ role: name, permission: picked(permission), organizationId })),
    onSuccess: async (_, { name }) => {
      await queryClient.invalidateQueries({
        queryKey: organizationQueries.roles(organizationId).queryKey,
      })
      notify.success(t(role ? `${K}.saved` : `${K}.created`, { role: role?.role ?? name }))
      onDone()
    },
    meta: { failure: t(role ? `${K}.notSaved` : `${K}.notCreated`) },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {role ? t(`${K}.editRole`, { role: role.role }) : t(`${K}.newRole`)}
          </DialogTitle>
        </DialogHeader>
        <form
          noValidate
          id="role-form"
          className="flex flex-col gap-6"
          onSubmit={(event) => void form.handleSubmit((values) => save.run(values))(event)}
        >
          {role ? null : (
            <Field data-invalid={nameError ? true : undefined}>
              <FieldLabel htmlFor="role-name">{t(`${K}.roleName`)}</FieldLabel>
              <Input
                id="role-name"
                autoComplete="off"
                aria-invalid={nameError ? true : undefined}
                {...registerClearing(form, 'name')}
              />
              {nameError ? <FieldError>{nameError}</FieldError> : null}
            </Field>
          )}
          <Controller
            control={form.control}
            name="permission"
            render={({ field }) => (
              <FieldSet data-invalid={permissionError ? true : undefined}>
                <FieldLegend variant="label">{t(`${K}.permissions`)}</FieldLegend>
                <div className="flex flex-col gap-3">
                  {RESOURCES.map((resource) => {
                    const resourceLabel = t(`${K}.resources.${resource}`)
                    return (
                      <div key={resource} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <p className="w-28 shrink-0 text-sm font-medium">{resourceLabel}</p>
                        {statements[resource].map((action) => {
                          const id = `permission-${resource}-${action}`
                          const ticked = field.value[resource]?.includes(action) ?? false
                          const toggle = (checked: boolean) => {
                            const rest = (field.value[resource] ?? []).filter((a) => a !== action)
                            field.onChange({
                              ...field.value,
                              [resource]: checked ? [...rest, action] : rest,
                            })
                            if (form.formState.errors.permission) form.clearErrors('permission')
                          }
                          return (
                            <div key={action} className="flex items-center gap-2">
                              <Checkbox
                                id={id}
                                checked={ticked}
                                disabled={!held[resource]?.includes(action)}
                                aria-label={t(`${K}.permission`, {
                                  resource: resourceLabel,
                                  action: t(`${K}.actions.${action}`),
                                })}
                                onCheckedChange={(checked) => toggle(checked === true)}
                              />
                              <label htmlFor={id} aria-hidden className="text-sm">
                                {t(`${K}.actions.${action}`)}
                              </label>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
                {permissionError ? <FieldError>{permissionError}</FieldError> : null}
              </FieldSet>
            )}
          />
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t(`${K}.cancel`)}</Button>
          </DialogClose>
          <Button type="submit" form="role-form" disabled={save.busy}>
            {role ? t(`${K}.save`) : t(`${K}.create`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
