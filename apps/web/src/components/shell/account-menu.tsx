import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChevronsUpDown, LogOut, MonitorIcon, MoonIcon, Plus, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { planLabel } from '#/components/billing/plan-copy'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '#/components/ui/sidebar'
import { authCall } from '#/lib/auth-call'
import { authClient } from '#/lib/auth-client'
import { type Member, initialOf, isMember, useCurrentUser } from '#/lib/current-user'
import { organizationQueries, switchOrganization } from '#/lib/organization-queries'
import { useApiMutation } from '#/lib/use-api-mutation'

import { CreateOrganizationDialog } from './create-organization-dialog'

const THEMES = [
  { value: 'light', label: 'appMenu.themeLight', Icon: SunIcon },
  { value: 'dark', label: 'appMenu.themeDark', Icon: MoonIcon },
  { value: 'system', label: 'appMenu.themeSystem', Icon: MonitorIcon },
] as const

export function AccountMenu() {
  const { user, name, signedOut } = useCurrentUser()
  // Signing out clears the person before the shell unmounts; nothing renders in between.
  if (!isMember(user)) return null
  return <AccountMenuButton user={user} name={name} signedOut={signedOut} />
}

function AccountMenuButton({
  user,
  name,
  signedOut,
}: {
  user: Member
  name: string
  signedOut: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
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
  const signOut = useApiMutation({
    mutationKey: ['auth', 'signOut'],
    mutationFn: () => authCall(authClient.signOut()),
    onSuccess: () => {
      signedOut()
      void navigate({ to: '/signin' })
    },
    meta: { failure: t('appMenu.notSignedOut') },
  })
  const current = user.organization
  const organizationLine = t('shell.usage', {
    organization: current.name,
    plan: planLabel(user.plan),
  })

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label={t('appMenu.accountMenu')}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{initialOf(name)}</AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">{organizationLine}</span>
              </span>
              <ChevronsUpDown className="ml-auto" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? 'top' : 'right'}
            align="end"
            sideOffset={8}
            className="w-64"
          >
            <DropdownMenuLabel className="font-normal">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t('orgSwitcher.organizations')}
            </DropdownMenuLabel>
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
            <DropdownMenuItem onSelect={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {t('orgSwitcher.create')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t('appMenu.theme')}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
                  {THEMES.map(({ value, label, Icon }) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      <Icon aria-hidden="true" />
                      {t(label)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut.run()}>
              <LogOut aria-hidden="true" />
              {t('appMenu.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CreateOrganizationDialog open={creating} onOpenChange={setCreating} />
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
