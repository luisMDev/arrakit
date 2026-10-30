import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChevronsUpDown, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { useCurrentUser } from '#/lib/current-user'
import { organizationQueries, switchOrganization } from '#/lib/organization-queries'
import { useApiMutation } from '#/lib/use-api-mutation'

import { CreateOrganizationDialog } from './create-organization-dialog'

/** The active organization and its plan; opens the person's organizations to switch or add one. */
export function OrgSwitcher() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, planLabel } = useCurrentUser()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const organizations = useQuery({
    ...organizationQueries.list(),
    enabled: open,
    meta: { failure: t('orgSwitcher.notLoaded') },
  })
  const switching = useApiMutation({
    mutationKey: ['org', 'setActive'],
    mutationFn: (organizationId: string) => switchOrganization(queryClient, organizationId),
    onSuccess: () => void navigate({ to: '/app' }),
    meta: { failure: t('orgSwitcher.notSwitched') },
  })

  const current = user?.organization
  if (!current) return null

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="max-w-64 text-muted-foreground"
            aria-label={t('orgSwitcher.label', { organization: current.name })}
          >
            <span className="truncate">
              {t('shell.usage', { organization: current.name, plan: planLabel })}
            </span>
            <ChevronsUpDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>{t('orgSwitcher.organizations')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={current.id}
            onValueChange={(id) => {
              if (id !== current.id) void switching.run(id)
            }}
          >
            {(organizations.data ?? []).map((organization) => (
              <DropdownMenuRadioItem key={organization.id} value={organization.id}>
                <span className="flex-1 truncate">{organization.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t(`pricing.plan.${organization.plan}`)}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t('orgSwitcher.create')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateOrganizationDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}
