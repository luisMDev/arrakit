import { isWorkEmail } from '@arrakit/address'
import type { InvitationView } from '@arrakit/contract'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
import { apiFailed, apiMessage } from '#/lib/api-errors'
import { displayName, initialOf, useCurrentUser } from '#/lib/current-user'
import { notify } from '#/lib/notify'
import { client, orpc } from '#/lib/orpc'
import { useFailureToast } from '#/lib/use-failure-toast'
import { cn } from '#/lib/utils'

import type { SectionProps } from './settings-page'
import { SettingsSectionLayout } from './settings-ui'

const K = 'settings.membersSettings'

type Member = { name: string; email: string; role: 'owner' | 'admin' | 'member' }
type AssignableRole = 'admin' | 'member'

const ROLE_LABEL = { owner: 'roleOwner', admin: 'roleAdmin', member: 'roleMember' } as const

const MORE_SEATS: Partial<Record<string, string>> = { free: 'moreSeatsFree', pro: 'moreSeatsPro' }

const DAY_MS = 86_400_000

/** Calendar days between `invitedOn` (YYYY-MM-DD) and `today`, local. */
export function daysSince(invitedOn: string, today = new Date()): number {
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.max(0, Math.round((todayUtc - Date.parse(`${invitedOn}T00:00:00Z`)) / DAY_MS))
}

const emailDomain = (email: string) => email.split('@').at(-1) ?? 'organization.com'

export function MembersSection({ open }: SectionProps) {
  const { t } = useTranslation()
  const me = useCurrentUser()
  const queryClient = useQueryClient()
  const membersQuery = orpc.members.list.queryOptions()
  const invitesQuery = orpc.invitations.list.queryOptions()
  const members = useQuery({ ...membersQuery, enabled: me.isAdmin })
  const invites = useQuery({ ...invitesQuery, enabled: me.isAdmin })

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AssignableRole>('member')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const loadError = members.error ?? invites.error
  useFailureToast(loadError, '[members] loading members failed', t(`${K}.notLoaded`))

  if (!me.isAdmin || !me.user) return <></>
  const myEmail = me.user.email
  const placeholder = `name@${emailDomain(myEmail)}`
  const memberList = members.data ?? []
  const inviteList = invites.data ?? []

  const setMembers = (fn: (list: Member[]) => Member[]) =>
    queryClient.setQueryData<Member[]>(membersQuery.queryKey, (list) => fn(list ?? []))
  const setInvites = (fn: (list: InvitationView[]) => InvitationView[]) =>
    queryClient.setQueryData<InvitationView[]>(invitesQuery.queryKey, (list) => fn(list ?? []))

  async function once(work: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await work()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const failed = (context: string, err: unknown, fallback: string) =>
    apiFailed(`[members] ${context}`, err, fallback, apiMessage)

  const manages = (member: Member) =>
    me.isAdmin &&
    member.email !== myEmail &&
    member.role !== 'owner' &&
    (member.role !== 'admin' || me.isOwner)

  function invite(event: FormEvent) {
    event.preventDefault()
    const address = email.trim()
    const lower = address.toLowerCase()
    if (!address || !isWorkEmail(address)) {
      setEmailError(t(`${K}.enterWorkEmail`, { example: placeholder }))
      return
    }
    if (memberList.some((m) => m.email.toLowerCase() === lower)) {
      setEmailError(t(`${K}.alreadyInOrganization`, { email: lower }))
      return
    }
    if (inviteList.some((i) => i.email.toLowerCase() === lower)) {
      setEmailError(t(`${K}.alreadyInvited`, { email: lower }))
      return
    }
    void once(async () => {
      try {
        const sent = await client.invitations.invite({ email: address, role })
        setInvites((list) =>
          list.some((i) => i.id === sent.id)
            ? list.map((i) => (i.id === sent.id ? sent : i))
            : [...list, sent],
        )
        setEmail('')
        setRole('member')
        if (sent.emailSent) notify.success(t(`${K}.inviteSent`, { email: sent.email }))
        else
          notify.warning(t(`${K}.emailNotSent`), {
            description: t(`${K}.inviteSavedNotSent`, { email: sent.email }),
          })
      } catch (err) {
        failed('inviting failed', err, t(`${K}.notInvited`, { email: address }))
      }
    })
  }

  async function changeRole(member: Member, next: AssignableRole) {
    const name = displayName(member)
    try {
      const changed = await client.members.changeRole({ email: member.email, role: next })
      setMembers((list) => list.map((m) => (m.email === member.email ? changed : m)))
      notify.success(t(changed.role === 'admin' ? `${K}.nowAdmin` : `${K}.nowMember`, { name }))
    } catch (err) {
      failed('changing a role failed', err, t(`${K}.roleNotChanged`, { name }))
      setMembers((list) => [...list])
    }
  }

  const remove = (member: Member) =>
    once(async () => {
      const name = displayName(member)
      try {
        await client.members.remove({ email: member.email })
        setMembers((list) => list.filter((m) => m.email !== member.email))
        notify.success(t(`${K}.removed`, { name, organization: me.user?.organization?.name ?? '' }))
      } catch (err) {
        failed('removing failed', err, t(`${K}.notRemoved`, { name }))
      }
    })

  const resend = (invitation: InvitationView) =>
    once(async () => {
      try {
        const sent = await client.invitations.resend({ id: invitation.id })
        setInvites((list) => list.map((i) => (i.id === sent.id ? sent : i)))
        notify.success(t(`${K}.inviteResent`, { email: sent.email }))
      } catch (err) {
        failed('resending failed', err, t(`${K}.notResent`))
      }
    })

  const cancel = (invitation: InvitationView) =>
    once(async () => {
      try {
        await client.invitations.cancel({ id: invitation.id })
        setInvites((list) => list.filter((i) => i.id !== invitation.id))
        notify.success(t(`${K}.inviteCancelled`, { email: invitation.email }))
      } catch (err) {
        failed('cancelling failed', err, t(`${K}.notCancelled`))
      }
    })

  const invitedLine = (invitation: InvitationView) => {
    const days = daysSince(invitation.invitedOn)
    if (days === 0) return t(`${K}.invitedToday`)
    if (days === 1) return t(`${K}.invitedYesterday`)
    return t(`${K}.invitedDaysAgo`, { days })
  }

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
                <Button variant="link" className="h-auto p-0" onClick={() => open('billing')}>
                  {t(`${K}.${moreSeats}`)}
                </Button>
              </>
            ) : null}
          </p>
        ) : null
      }
    >
      <Card>
        <CardContent>
          <form noValidate onSubmit={invite} className="flex flex-col gap-2">
            <Field data-invalid={emailError ? true : undefined}>
              <FieldLabel htmlFor="invite-email">{t(`${K}.inviteLabel`)}</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="invite-email"
                  type="email"
                  autoComplete="off"
                  placeholder={placeholder}
                  className="min-w-56 flex-1"
                  value={email}
                  aria-invalid={emailError ? true : undefined}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setEmailError(null)
                  }}
                />
                <Select value={role} onValueChange={(value) => setRole(value as AssignableRole)}>
                  <SelectTrigger aria-label={t(`${K}.role`)} className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">{t(`${K}.roleMember`)}</SelectItem>
                    <SelectItem value="admin">{t(`${K}.roleAdmin`)}</SelectItem>
                  </SelectContent>
                </Select>
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

      <Card className="py-2">
        <CardContent>
          <ul aria-label={t(`${K}.title`)}>
            {memberList.map((member, index) => {
              const name = displayName(member)
              const mine = member.email === myEmail
              return (
                <li key={member.email} data-member={member.email}>
                  {index > 0 ? <Separator /> : null}
                  <div className="flex flex-wrap items-center gap-3 py-3">
                    <Avatar>
                      <AvatarFallback className={cn(mine && 'bg-primary text-primary-foreground')}>
                        {initialOf(name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className="text-muted-foreground truncate text-sm">{member.email}</p>
                    </div>
                    {manages(member) && me.isOwner ? (
                      <Select
                        value={member.role}
                        onValueChange={(value) => void changeRole(member, value as AssignableRole)}
                      >
                        <SelectTrigger aria-label={t(`${K}.roleOf`, { name })} className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">{t(`${K}.roleMember`)}</SelectItem>
                          <SelectItem value="admin">{t(`${K}.roleAdmin`)}</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        {t(`${K}.${ROLE_LABEL[member.role]}`)}
                      </span>
                    )}
                    {manages(member) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void remove(member)}
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
                    {t(`${K}.${ROLE_LABEL[invitation.role]}`)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void resend(invitation)}
                  >
                    {t(`${K}.resend`)}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void cancel(invitation)}
                  >
                    {t(`${K}.cancel`)}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </SettingsSectionLayout>
  )
}
