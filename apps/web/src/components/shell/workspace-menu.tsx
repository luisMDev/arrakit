import type { Workspace } from '@arrakit/contract'
import { PAID_PLANS } from '@arrakit/plans'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ChevronsUpDown,
  CircleArrowUp,
  LayoutGrid,
  LogOut,
  MonitorIcon,
  MoonIcon,
  Plus,
  SunIcon,
  SunMoon,
} from 'lucide-react'
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
import { WorkspaceFormDialog } from '#/components/workspaces/workspace-form-dialog'
import { authCall } from '#/lib/auth-call'
import { authClient } from '#/lib/auth-client'
import { type Member, initialOf, isMember, useCurrentUser } from '#/lib/current-user'
import { organizationQueries, switchOrganization } from '#/lib/organization-queries'
import { orpc } from '#/lib/orpc'
import { useApiMutation } from '#/lib/use-api-mutation'

import { ORGANIZATION_NAV, navFor } from './app-nav'
import { CreateOrganizationDialog } from './create-organization-dialog'

const K = 'workspaceMenu'

const TOP_PLAN = PAID_PLANS[PAID_PLANS.length - 1]

const THEMES = [
  { value: 'light', label: 'appMenu.themeLight', Icon: SunIcon },
  { value: 'dark', label: 'appMenu.themeDark', Icon: MoonIcon },
  { value: 'system', label: 'appMenu.themeSystem', Icon: MonitorIcon },
] as const

/** `workspace` is the open one, when the person is inside a workspace. */
export function WorkspaceMenu({ workspace }: { workspace?: Workspace }) {
  const { user } = useCurrentUser()
  // Signing out clears the person before the shell unmounts; nothing renders in between.
  if (!isMember(user)) return null
  return <WorkspaceMenuButton user={user} current={workspace} />
}

/**
 * Heads the sidebar: names the open workspace (else the organization) and opens its workspaces,
 * the person's organizations and, last, the organization's destinations, the theme and sign out.
 * Settings shows the person in its place.
 */
function WorkspaceMenuButton({ user, current }: { user: Member; current?: Workspace }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const access = useCurrentUser()
  const { isMobile, setOpenMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [creatingOrganization, setCreatingOrganization] = useState(false)
  const organization = user.organization
  const readsWorkspaces = access.can({ workspace: ['read'] })
  const workspaces = useQuery({
    ...orpc.workspaces.list.queryOptions(),
    enabled: open && readsWorkspaces,
    meta: { failure: t('workspaces.notLoaded') },
  })
  const members = useQuery({
    ...organizationQueries.memberCount(organization.id),
    enabled: open,
  })
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
      access.signedOut()
      void navigate({ to: '/signin' })
    },
    meta: { failure: t('appMenu.notSignedOut') },
  })
  const plan = planLabel(user.plan)
  const canUpgrade = access.managesBilling && user.plan !== TOP_PLAN && user.plan !== 'internal'

  const leaveSidebar = () => {
    if (isMobile) setOpenMobile(false)
  }
  const openWorkspace = (id: string) => {
    leaveSidebar()
    void navigate({ to: '/app/workspaces/$workspaceId', params: { workspaceId: id } })
  }
  const title = current?.name ?? organization.name

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label={t(`${K}.label`)}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{initialOf(title)}</AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{title}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {current ? organization.name : plan}
                </span>
              </span>
              <ChevronsUpDown className="ml-auto" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? 'bottom' : 'right'}
            align="start"
            sideOffset={8}
            className="w-72"
          >
            <DropdownMenuLabel className="flex items-center gap-2 font-normal">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">
                  {initialOf(organization.name)}
                </AvatarFallback>
              </Avatar>
              <span className="grid flex-1 leading-tight">
                <span className="truncate text-sm font-medium">{organization.name}</span>
                <span data-summary className="text-muted-foreground truncate text-xs">
                  {members.data === undefined
                    ? plan
                    : t(`${K}.planAndMembers`, { plan, count: members.data })}
                </span>
              </span>
            </DropdownMenuLabel>
            {readsWorkspaces ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  {t('workspaces.title')}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  aria-label={t('workspaces.title')}
                  value={current?.id ?? ''}
                  onValueChange={(id) => {
                    if (id !== current?.id) openWorkspace(id)
                  }}
                >
                  {(workspaces.data ?? []).map((workspace) => (
                    <DropdownMenuRadioItem key={workspace.id} value={workspace.id}>
                      <span
                        aria-hidden="true"
                        className="bg-muted flex size-5 shrink-0 items-center justify-center rounded text-xs"
                      >
                        {initialOf(workspace.name)}
                      </span>
                      <span className="truncate">{workspace.name}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                {workspaces.data?.length === 0 ? (
                  <DropdownMenuItem disabled>{t('workspaces.empty')}</DropdownMenuItem>
                ) : null}
                {access.can({ workspace: ['create'] }) ? (
                  <DropdownMenuItem onSelect={() => setCreatingWorkspace(true)}>
                    <Plus aria-hidden="true" />
                    {t('workspaces.new')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem asChild>
                  <Link to="/app/workspaces" onClick={leaveSidebar}>
                    <LayoutGrid aria-hidden="true" />
                    {t('workspaces.back')}
                  </Link>
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              {t('orgSwitcher.organizations')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              aria-label={t('orgSwitcher.organizations')}
              value={organization.id}
              onValueChange={(id) => {
                if (id !== organization.id) void switching.run(id)
              }}
            >
              {(organizations.data ?? []).map((other) => (
                <DropdownMenuRadioItem key={other.id} value={other.id}>
                  <span className="flex-1 truncate">{other.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {t(`pricing.plan.${other.plan}`)}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuItem onSelect={() => setCreatingOrganization(true)}>
              <Plus aria-hidden="true" />
              {t('orgSwitcher.create')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {canUpgrade ? (
              <DropdownMenuItem asChild>
                <Link to="/app/plans" onClick={leaveSidebar}>
                  <CircleArrowUp aria-hidden="true" />
                  {t(`${K}.upgrade`)}
                </Link>
              </DropdownMenuItem>
            ) : null}
            {navFor(access, ORGANIZATION_NAV).map(({ label, icon: Icon, link }) => (
              <DropdownMenuItem key={label} asChild>
                <Link {...link} onClick={leaveSidebar}>
                  <Icon aria-hidden="true" />
                  {t(`nav.${label}`)}
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <SunMoon aria-hidden="true" />
                {t('appMenu.theme')}
              </DropdownMenuSubTrigger>
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
            <DropdownMenuItem onSelect={() => void signOut.run()}>
              <LogOut aria-hidden="true" />
              {t('appMenu.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <WorkspaceFormDialog
          open={creatingWorkspace}
          onOpenChange={setCreatingWorkspace}
          onCreated={(workspace) => openWorkspace(workspace.id)}
        />
        <CreateOrganizationDialog
          open={creatingOrganization}
          onOpenChange={setCreatingOrganization}
        />
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
