import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { useCurrentUser } from '#/lib/current-user'
import { notify } from '#/lib/notify'
import { orpc } from '#/lib/orpc'
import { useApiMutation } from '#/lib/use-api-mutation'

import { ConfirmDeleteDialog } from './confirm-delete-dialog'
import { SettingsSectionLayout } from './settings-ui'

const K = 'settings.securitySettings'

export function SecuritySection() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const me = useCurrentUser()
  const [confirming, setConfirming] = useState(false)
  const deleteOrganization = useApiMutation({
    ...orpc.organizations.delete.mutationOptions(),
    onSuccess: async () => {
      setConfirming(false)
      notify.success(t(`${K}.deleted`))
      await me.refresh()
      void navigate({ to: '/profile' })
    },
    meta: { failure: t(`${K}.notDeleted`) },
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
          <ConfirmDeleteDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={t(`${K}.confirmTitle`)}
            confirmLabel={t(`${K}.deleteOrganization`)}
            pending={deleteOrganization.isPending}
            onConfirm={() => void deleteOrganization.run()}
          />
        </>
      ) : (
        <p className="text-muted-foreground text-sm">{t(`${K}.ownerOnly`)}</p>
      )}
    </SettingsSectionLayout>
  )
}
