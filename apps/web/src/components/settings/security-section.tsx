import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { authCall } from '#/lib/auth-call'
import { authClient } from '#/lib/auth-client'
import { useMember } from '#/lib/current-user'
import { notify } from '#/lib/notify'
import { organizationQueries, switchOrganization } from '#/lib/organization-queries'
import { useApiMutation } from '#/lib/use-api-mutation'

import { ConfirmDialog } from './confirm-dialog'
import { SettingsSectionLayout } from './settings-ui'

const K = 'settings.securitySettings'

const org = authClient.organization

/** Moves to another of the person's organizations; resolves `false` when none is left. */
async function moveToNext(queryClient: QueryClient): Promise<boolean> {
  const [next] = await queryClient.fetchQuery({ ...organizationQueries.list(), staleTime: 0 })
  await switchOrganization(queryClient, next?.id ?? null)
  return next !== undefined
}

export function SecuritySection() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useMember()
  const [confirming, setConfirming] = useState(false)
  const { organization } = me.user
  const organizationId = organization.id

  const done = async (message: string) => {
    setConfirming(false)
    const moved = await moveToNext(queryClient)
    notify.success(message)
    void navigate({ to: moved ? '/app' : '/profile' })
  }

  const deleteOrganization = useApiMutation({
    mutationKey: ['org', 'delete'],
    mutationFn: () => authCall(org.delete({ organizationId })),
    onSuccess: () => done(t(`${K}.deleted`)),
    meta: { failure: t(`${K}.notDeleted`) },
  })

  const leave = useApiMutation({
    mutationKey: ['org', 'leave'],
    mutationFn: () => authCall(org.leave({ organizationId })),
    onSuccess: () => done(t(`${K}.left`, { organization: organization.name })),
    meta: { failure: t(`${K}.notLeft`) },
  })

  return (
    <SettingsSectionLayout id="security" title={t(`${K}.title`)}>
      {me.isOwner ? (
        <>
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle>{t(`${K}.deleteOrganization`)}</CardTitle>
              <CardDescription>{t(`${K}.deleteOrganizationHint`)}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="destructive" onClick={() => setConfirming(true)}>
                {t(`${K}.delete`)}
              </Button>
            </CardContent>
          </Card>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={t(`${K}.confirmTitle`)}
            confirmLabel={t(`${K}.deleteOrganization`)}
            pending={deleteOrganization.busy}
            onConfirm={() => void deleteOrganization.run()}
          />
        </>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t(`${K}.leaveOrganization`)}</CardTitle>
              <CardDescription>
                {t(`${K}.leaveHint`, { organization: organization.name })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => setConfirming(true)}>
                {t(`${K}.leave`)}
              </Button>
            </CardContent>
          </Card>
          <p className="text-muted-foreground text-sm">{t(`${K}.ownerOnly`)}</p>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={t(`${K}.confirmLeaveTitle`, { organization: organization.name })}
            confirmLabel={t(`${K}.leaveOrganization`)}
            pending={leave.busy}
            onConfirm={() => void leave.run()}
          />
        </>
      )}
    </SettingsSectionLayout>
  )
}
