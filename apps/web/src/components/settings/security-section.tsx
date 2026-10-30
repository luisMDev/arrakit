import { useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { apiMessage, reportError } from '#/lib/api-errors'
import { useCurrentUser } from '#/lib/current-user'
import { notify } from '#/lib/notify'
import { client } from '#/lib/orpc'

import { ConfirmDeleteDialog } from './confirm-delete-dialog'
import { SettingsSectionLayout } from './settings-ui'

const K = 'settings.securitySettings'

export function SecuritySection() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const me = useCurrentUser()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)

  async function deleteOrganization() {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    try {
      await client.organizations.delete()
    } catch (err) {
      reportError('[security] deleting the organization failed', err)
      notify.error(apiMessage(err, (status) => status >= 400) ?? t(`${K}.notDeleted`))
      deletingRef.current = false
      setDeleting(false)
      return
    }
    setConfirming(false)
    notify.success(t(`${K}.deleted`))
    me.signedOut()
    void navigate({ to: '/profile' })
  }

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
            pending={deleting}
            onConfirm={() => void deleteOrganization()}
          />
        </>
      ) : (
        <p className="text-muted-foreground text-sm">{t(`${K}.ownerOnly`)}</p>
      )}
    </SettingsSectionLayout>
  )
}
