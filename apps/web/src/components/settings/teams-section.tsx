import { personName } from '@arrakit/address'
import type { TeamMember } from '@arrakit/contract'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '#/components/shell/empty-state'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
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
import { useMember } from '#/lib/current-user'
import { nameForm, registerClearing, useClearingForm } from '#/lib/form'
import { notify } from '#/lib/notify'
import { type Team, organizationQueries } from '#/lib/organization-queries'
import { useApiMutation } from '#/lib/use-api-mutation'

import { ConfirmDialog } from './confirm-dialog'
import { SettingsSectionLayout } from './settings-ui'

const K = 'settings.teamsSettings'

const org = authClient.organization

const nameOf = (person: { name: string; email: string }) => personName(person.name, person.email)

export function TeamsSection() {
  const { t } = useTranslation()
  const me = useMember()
  const queryClient = useQueryClient()
  const organizationId = me.organization.id
  const teamsQuery = organizationQueries.teams(organizationId)
  const teams = useQuery({ ...teamsQuery, meta: { failure: t(`${K}.notLoaded`) } })
  const form = useClearingForm({
    resolver: zodResolver(nameForm(t(`${K}.enterName`))),
    defaultValues: { name: '' },
  })
  const nameError = form.formState.errors.name?.message

  const create = useApiMutation({
    mutationKey: ['org', 'createTeam'],
    mutationFn: ({ name }: { name: string }) => authCall(org.createTeam({ name, organizationId })),
    onSuccess: async (team) => {
      form.reset()
      await queryClient.invalidateQueries({ queryKey: teamsQuery.queryKey })
      notify.success(t(`${K}.created`, { team: team.name }))
    },
    meta: { failure: t(`${K}.notCreated`) },
  })

  return (
    <SettingsSectionLayout id="teams" title={t(`${K}.title`)}>
      <p className="text-muted-foreground text-sm">{t(`${K}.hint`)}</p>
      {me.can({ team: ['create'] }) ? (
        <Card>
          <CardContent>
            <form
              noValidate
              onSubmit={(event) => void form.handleSubmit((values) => create.run(values))(event)}
            >
              <Field data-invalid={nameError ? true : undefined}>
                <FieldLabel htmlFor="team-name">{t(`${K}.teamName`)}</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="team-name"
                    autoComplete="off"
                    className="min-w-56 flex-1"
                    aria-invalid={nameError ? true : undefined}
                    {...registerClearing(form, 'name')}
                  />
                  <Button type="submit" disabled={create.isPending}>
                    {t(`${K}.create`)}
                  </Button>
                </div>
                {nameError ? <FieldError>{nameError}</FieldError> : null}
              </Field>
            </form>
          </CardContent>
        </Card>
      ) : null}
      {teams.data?.length === 0 ? <EmptyState icon={Users} title={t(`${K}.empty`)} /> : null}
      {teams.data?.map((team) => (
        <TeamCard key={team.id} team={team} organizationId={organizationId} />
      ))}
    </SettingsSectionLayout>
  )
}

function TeamCard({ team, organizationId }: { team: Team; organizationId: string }) {
  const { t } = useTranslation()
  const me = useMember()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [newcomer, setNewcomer] = useState('')
  const canRename = me.can({ team: ['update'] })
  const canAdd = me.can({ member: ['update'] })
  const canRemove = me.can({ member: ['delete'] })
  const teamsKey = organizationQueries.teams(organizationId).queryKey
  const membersQuery = organizationQueries.teamMembers(team.id)
  const members = useQuery({ ...membersQuery, meta: { failure: t(`${K}.notLoaded`) } })
  const everyone = useQuery({
    ...organizationQueries.members(organizationId),
    enabled: canAdd,
    meta: { failure: t(`${K}.notLoaded`) },
  })
  const form = useClearingForm({
    resolver: zodResolver(nameForm(t(`${K}.enterName`))),
    values: { name: team.name },
  })
  const reloadMembers = () => queryClient.invalidateQueries({ queryKey: membersQuery.queryKey })

  const rename = useApiMutation({
    mutationKey: ['org', 'updateTeam'],
    mutationFn: ({ name }: { name: string }) =>
      authCall(org.updateTeam({ teamId: team.id, data: { name } })),
    onSuccess: async (_, { name }) => {
      await queryClient.invalidateQueries({ queryKey: teamsKey })
      notify.success(t(`${K}.renamed`, { team: name }))
    },
    onError: () => form.reset(),
    meta: { failure: t(`${K}.notRenamed`) },
  })

  const remove = useApiMutation({
    mutationKey: ['org', 'removeTeam'],
    mutationFn: () => authCall(org.removeTeam({ teamId: team.id, organizationId })),
    onSuccess: async () => {
      setConfirming(false)
      await queryClient.invalidateQueries({ queryKey: teamsKey })
      notify.success(t(`${K}.deleted`, { team: team.name }))
    },
    meta: { failure: t(`${K}.notDeleted`) },
  })

  const add = useApiMutation({
    mutationKey: ['org', 'addTeamMember'],
    mutationFn: (person: { userId: string; name: string }) =>
      authCall(org.addTeamMember({ teamId: team.id, userId: person.userId })),
    onSuccess: async (_, person) => {
      setNewcomer('')
      await reloadMembers()
      notify.success(t(`${K}.added`, { name: person.name, team: team.name }))
    },
    meta: {
      failure: (person: { name: string }) => t(`${K}.notAdded`, { name: person.name }),
    },
  })

  const takeOut = useApiMutation({
    mutationKey: ['org', 'removeTeamMember'],
    mutationFn: (person: TeamMember) =>
      authCall(org.removeTeamMember({ teamId: team.id, userId: person.userId })),
    onSuccess: async (_, person) => {
      await reloadMembers()
      notify.success(t(`${K}.removed`, { name: nameOf(person), team: team.name }))
    },
    meta: {
      failure: (person: TeamMember) => t(`${K}.notRemoved`, { name: nameOf(person) }),
    },
  })

  const inTeam = new Set((members.data ?? []).map((member) => member.userId))
  const candidates = (everyone.data ?? []).filter((member) => !inTeam.has(member.userId))
  const chosen = candidates.find((member) => member.userId === newcomer)

  function saveName({ name }: { name: string }) {
    if (name === team.name) return form.reset()
    return rename.run({ name })
  }

  return (
    <Card data-team={team.name}>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        {canRename ? (
          <form
            noValidate
            className="flex flex-1 gap-2"
            onSubmit={(event) => void form.handleSubmit(saveName)(event)}
          >
            <Input
              aria-label={t(`${K}.nameOf`, { team: team.name })}
              aria-invalid={form.formState.errors.name ? true : undefined}
              className="max-w-xs"
              {...registerClearing(form, 'name')}
            />
            <Button type="submit" variant="outline" disabled={rename.isPending}>
              {t(`${K}.save`)}
            </Button>
          </form>
        ) : (
          <CardTitle className="flex-1">{team.name}</CardTitle>
        )}
        {me.can({ team: ['delete'] }) ? (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            {t(`${K}.deleteTeam`, { team: team.name })}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul aria-label={t(`${K}.membersOf`, { team: team.name })}>
          {members.data?.length === 0 ? (
            <li className="text-muted-foreground text-sm">{t(`${K}.noMembers`)}</li>
          ) : null}
          {members.data?.map((member, index) => (
            <li key={member.userId} data-team-member={member.email}>
              {index > 0 ? <Separator /> : null}
              <div className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{nameOf(member)}</p>
                  <p className="text-muted-foreground truncate text-sm">{member.email}</p>
                </div>
                {canRemove ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={takeOut.isPending}
                    aria-label={t(`${K}.removeFrom`, { name: nameOf(member), team: team.name })}
                    onClick={() => void takeOut.run(member)}
                  >
                    {t(`${K}.remove`)}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {canAdd && candidates.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Select value={newcomer} onValueChange={setNewcomer}>
              <SelectTrigger
                aria-label={t(`${K}.addTo`, { team: team.name })}
                className="min-w-56 flex-1"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {personName(member.user.name, member.user.email)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={!chosen || add.isPending}
              onClick={() =>
                chosen &&
                void add.run({
                  userId: chosen.userId,
                  name: personName(chosen.user.name, chosen.user.email),
                })
              }
            >
              {t(`${K}.add`)}
            </Button>
          </div>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t(`${K}.confirmDeleteTitle`, { team: team.name })}
        confirmLabel={t(`${K}.deleteTeam`, { team: team.name })}
        pending={remove.isPending}
        onConfirm={() => void remove.run()}
      />
    </Card>
  )
}
