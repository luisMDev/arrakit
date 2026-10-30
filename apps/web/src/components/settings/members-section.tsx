import { domainOf, isWorkEmail, normalizeEmail, personName } from '@arrakit/address'
import {
  type Permissions,
  allows,
  isOwnerRole,
  isStaticRole,
  permissionsOf,
  rolesOf,
} from '@arrakit/auth/permissions'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Separator } from '#/components/ui/separator'
import { authCall } from '#/lib/auth-call'
import { authClient } from '#/lib/auth-client'
import { initialOf, useCurrentUser } from '#/lib/current-user'
import { registerClearing, useClearingForm } from '#/lib/form'
import { notify } from '#/lib/notify'
import {
  type CustomRole,
  type OrganizationMember,
  type PendingInvitation,
  organizationQueries,
} from '#/lib/organization-queries'
import { useApiMutation } from '#/lib/use-api-mutation'
import { cn } from '#/lib/utils'

import { SettingsSectionLayout } from './settings-ui'

const K = 'settings.membersSettings'

const org = authClient.organization

type InviteBody = { email: string; role: string; organizationId: string; resend?: boolean }

/** Better Auth's client types `emailSent` as an input, though the server sets it. */
const inviteMember = (body: InviteBody) =>
  authCall(org.inviteMember(body as Parameters<typeof org.inviteMember>[0]))

const displayName = (member: OrganizationMember) => personName(member.user.name, member.user.email)

const STATIC_ROLE_LABEL = { owner: 'roleOwner', admin: 'roleAdmin', member: 'roleMember' } as const

/** A role string as people read it: built-in roles translated, custom ones by name. */
export function roleLabel(t: TFunction, role: string): string {
  return rolesOf(role)
    .map((name) => (isStaticRole(name) ? t(`${K}.${STATIC_ROLE_LABEL[name]}`) : name))
    .join(', ')
}

const MORE_SEATS: Partial<Record<string, string>> = { free: 'moreSeatsFree', pro: 'moreSeatsPro' }

const DAY_MS = 86_400_000

/** Calendar days, local, from `invitedAt` to `today`. */
export function daysSince(invitedAt: Date, today = new Date()): number {
  const midnight = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.max(0, Math.round((midnight(today) - midnight(invitedAt)) / DAY_MS))
}

function inviteForm(
  t: TFunction,
  placeholder: string,
  memberEmails: readonly string[],
  invitedEmails: readonly string[],
) {
  const listed = (emails: readonly string[], lower: string) =>
    emails.some((email) => normalizeEmail(email) === lower)
  return z.object({
    email: z
      .string()
      .trim()
      .superRefine((address, ctx) => {
        const lower = normalizeEmail(address)
        const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
        if (!isWorkEmail(address)) return fail(t(`${K}.enterWorkEmail`, { example: placeholder }))
        if (listed(memberEmails, lower))
          return fail(t(`${K}.alreadyInOrganization`, { email: lower }))
        if (listed(invitedEmails, lower)) return fail(t(`${K}.alreadyInvited`, { email: lower }))
      }),
    role: z.string(),
  })
}

/** The roles `actorRole` may give: never owner, admin only from the owner, nothing beyond theirs. */
export function assignableRoles(
  actorRole: string,
  granted: Permissions,
  custom: readonly CustomRole[],
): string[] {
  const owner = isOwnerRole(actorRole)
  const customMap = Object.fromEntries(custom.map((r) => [r.role, r.permission]))
  return ['member', ...(owner ? ['admin'] : []), ...custom.map((r) => r.role)].filter(
    (role) => owner || allows(granted, permissionsOf(role, customMap)),
  )
}

export function MembersSection() {
  const { t } = useTranslation()
  const me = useCurrentUser()
  const queryClient = useQueryClient()
  const organizationId = me.user?.organization?.id ?? ''
  const meta = { failure: t(`${K}.notLoaded`) }
  const enabled = me.managesMembers && organizationId !== ''
  const membersQuery = organizationQueries.members(organizationId)
  const invitesQuery = organizationQueries.invitations(organizationId)
  const members = useQuery({ ...membersQuery, enabled, meta })
  const invites = useQuery({ ...invitesQuery, enabled, meta })
  const roles = useQuery({
    ...organizationQueries.roles(organizationId),
    enabled: enabled && me.can({ ac: ['read'] }),
    meta,
  })

  const myEmail = me.user?.email ?? ''
  const placeholder = `name@${domainOf(myEmail)}`
  const memberList = members.data ?? []
  const inviteList = invites.data ?? []
  const customRoles = roles.data ?? []
  const customMap = Object.fromEntries(customRoles.map((r) => [r.role, r.permission]))
  const granted = (me.user?.permissions ?? {}) as Permissions
  const assignable = assignableRoles(me.role ?? '', granted, customRoles)
  const form = useClearingForm({
    resolver: zodResolver(
      inviteForm(
        t,
        placeholder,
        memberList.map((m) => m.user.email),
        inviteList.map((i) => i.email),
      ),
    ),
    defaultValues: { email: '', role: 'member' },
  })
  const emailError = form.formState.errors.email?.message

  const reloadMembers = () => queryClient.invalidateQueries({ queryKey: membersQuery.queryKey })
  const reloadInvites = () => queryClient.invalidateQueries({ queryKey: invitesQuery.queryKey })

  const invite = useApiMutation({
    mutationKey: ['org', 'invite'],
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      inviteMember({ email, role, organizationId }),
    onSuccess: (sent) => {
      form.reset()
      notify.success(t(`${K}.inviteSent`, { email: sent.email }))
    },
    onSettled: reloadInvites,
    meta: { failure: ({ email }: { email: string }) => t(`${K}.notInvited`, { email }) },
  })

  const changeRole = useApiMutation({
    mutationKey: ['org', 'updateMemberRole'],
    mutationFn: ({ member, role }: { member: OrganizationMember; role: string }) =>
      authCall(org.updateMemberRole({ memberId: member.id, role, organizationId })),
    onSuccess: (_, { member, role }) => {
      const name = displayName(member)
      if (role === 'admin') notify.success(t(`${K}.nowAdmin`, { name }))
      else if (role === 'member') notify.success(t(`${K}.nowMember`, { name }))
      else notify.success(t(`${K}.nowRole`, { name, role }))
    },
    onSettled: reloadMembers,
    meta: {
      failure: ({ member }: { member: OrganizationMember }) =>
        t(`${K}.roleNotChanged`, { name: displayName(member) }),
    },
  })

  const remove = useApiMutation({
    mutationKey: ['org', 'removeMember'],
    mutationFn: (member: OrganizationMember) =>
      authCall(org.removeMember({ memberIdOrEmail: member.id, organizationId })),
    onSuccess: async (_, member) => {
      await reloadMembers()
      const organization = me.user?.organization?.name ?? ''
      notify.success(t(`${K}.removed`, { name: displayName(member), organization }))
    },
    meta: {
      failure: (member: OrganizationMember) => t(`${K}.notRemoved`, { name: displayName(member) }),
    },
  })

  const resend = useApiMutation({
    mutationKey: ['org', 'resendInvitation'],
    mutationFn: (invitation: PendingInvitation) =>
      inviteMember({
        email: invitation.email,
        role: invitation.role,
        organizationId,
        resend: true,
      }),
    onSuccess: (sent) => notify.success(t(`${K}.inviteResent`, { email: sent.email })),
    onSettled: reloadInvites,
    meta: { failure: t(`${K}.notResent`) },
  })

  const cancel = useApiMutation({
    mutationKey: ['org', 'cancelInvitation'],
    mutationFn: (invitation: PendingInvitation) =>
      authCall(org.cancelInvitation({ invitationId: invitation.id })),
    onSuccess: async (_, invitation) => {
      await reloadInvites()
      notify.success(t(`${K}.inviteCancelled`, { email: invitation.email }))
    },
    meta: { failure: t(`${K}.notCancelled`) },
  })

  const busy = invite.isPending || remove.isPending || resend.isPending || cancel.isPending

  if (!me.managesMembers || !me.user) return <></>

  const outranks = (member: OrganizationMember) =>
    me.isOwner || allows(granted, permissionsOf(member.role, customMap))
  const manages = (member: OrganizationMember) =>
    member.user.email !== myEmail &&
    !isOwnerRole(member.role) &&
    (!rolesOf(member.role).includes('admin') || me.isOwner) &&
    outranks(member)
  const canChangeRoles = me.can({ member: ['update'] })
  const canRemove = me.can({ member: ['delete'] })
  const canInvite = me.can({ invitation: ['create'] })
  const canCancel = me.can({ invitation: ['cancel'] })

  const invitedLine = (invitation: PendingInvitation) => {
    const days = daysSince(invitation.createdAt)
    if (days === 0) return t(`${K}.invitedToday`)
    if (days === 1) return t(`${K}.invitedYesterday`)
    return t(`${K}.invitedDaysAgo`, { days })
  }

  const roleOptions = (current?: string) =>
    [...new Set([...(current ? [current] : []), ...assignable])].map((role) => (
      <SelectItem key={role} value={role}>
        {roleLabel(t, role)}
      </SelectItem>
    ))

  const moreSeats = me.user.plan ? MORE_SEATS[me.user.plan] : undefined
  const count = memberList.length

  return (
    <SettingsSectionLayout
      id="members"
      title={t(`${K}.title`)}
      aside={
        members.data ? (
          <p data-seats className="text-muted-foreground text-sm">
            {t(count === 1 ? `${K}.memberCountOne` : `${K}.memberCountMany`, { count })}
            {moreSeats ? (
              <>
                {' · '}
                <Button asChild variant="link" className="h-auto p-0">
                  <Link to="/app/settings" search={{ section: 'billing' }}>
                    {t(`${K}.${moreSeats}`)}
                  </Link>
                </Button>
              </>
            ) : null}
          </p>
        ) : null
      }
    >
      {canInvite ? (
        <Card>
          <CardContent>
            <form
              noValidate
              onSubmit={(event) => void form.handleSubmit((values) => invite.run(values))(event)}
              className="flex flex-col gap-2"
            >
              <Field data-invalid={emailError ? true : undefined}>
                <FieldLabel htmlFor="invite-email">{t(`${K}.inviteLabel`)}</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="invite-email"
                    type="email"
                    autoComplete="off"
                    placeholder={placeholder}
                    className="min-w-56 flex-1"
                    aria-invalid={emailError ? true : undefined}
                    {...registerClearing(form, 'email')}
                  />
                  <Controller
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger ref={field.ref} aria-label={t(`${K}.role`)} className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>{roleOptions()}</SelectContent>
                      </Select>
                    )}
                  />
                  <Button type="submit" disabled={busy}>
                    {t(`${K}.invite`)}
                  </Button>
                </div>
                {emailError ? <FieldError>{emailError}</FieldError> : null}
                <FieldDescription>{t(`${K}.rolesHint`)}</FieldDescription>
              </Field>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card className="py-2">
        <CardContent>
          <ul aria-label={t(`${K}.title`)}>
            {memberList.map((member, index) => {
              const name = displayName(member)
              const mine = member.user.email === myEmail
              return (
                <li key={member.id} data-member={member.user.email}>
                  {index > 0 ? <Separator /> : null}
                  <div className="flex flex-wrap items-center gap-3 py-3">
                    <Avatar>
                      <AvatarFallback className={cn(mine && 'bg-primary text-primary-foreground')}>
                        {initialOf(name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className="text-muted-foreground truncate text-sm">{member.user.email}</p>
                    </div>
                    {canChangeRoles && manages(member) ? (
                      <Select
                        value={member.role}
                        onValueChange={(role) => void changeRole.run({ member, role })}
                      >
                        <SelectTrigger aria-label={t(`${K}.roleOf`, { name })} className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>{roleOptions(member.role)}</SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        {roleLabel(t, member.role)}
                      </span>
                    )}
                    {canRemove && manages(member) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void remove.run(member)}
                      >
                        {t(`${K}.remove`)}
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
            {inviteList.map((invitation) => (
              <li key={invitation.id} data-invitation={invitation.email}>
                <Separator />
                <div className="flex flex-wrap items-center gap-3 py-3">
                  <Avatar>
                    <AvatarFallback className="border-muted-foreground/50 border border-dashed bg-transparent">
                      {initialOf(invitation.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{invitation.email}</p>
                    {invitation.emailSent ? (
                      <p className="text-muted-foreground text-sm">{invitedLine(invitation)}</p>
                    ) : (
                      <p className="text-destructive text-sm">{t(`${K}.emailNotSent`)}</p>
                    )}
                  </div>
                  <span className="text-muted-foreground text-sm">
                    {roleLabel(t, invitation.role)}
                  </span>
                  {canInvite ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void resend.run(invitation)}
                    >
                      {t(`${K}.resend`)}
                    </Button>
                  ) : null}
                  {canCancel ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void cancel.run(invitation)}
                    >
                      {t(`${K}.cancel`)}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </SettingsSectionLayout>
  )
}
