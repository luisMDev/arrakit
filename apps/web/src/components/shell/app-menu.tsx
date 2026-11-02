import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { planLabel } from '#/components/billing/plan-copy'
import type { SettingsSearch } from '#/components/settings/settings-page'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { Separator } from '#/components/ui/separator'
import { authCall } from '#/lib/auth-call'
import { authClient } from '#/lib/auth-client'
import { initialOf, useCurrentUser } from '#/lib/current-user'
import { useApiMutation } from '#/lib/use-api-mutation'

import { ThemeSwitcher } from './theme-switcher'

/** The account menu: a popover with the person, their destinations, the theme and sign out. */
export function AppMenu() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, name, can, managesMembers, signedOut } = useCurrentUser()
  const [open, setOpen] = useState(false)
  const signOutMutation = useApiMutation({
    mutationKey: ['auth', 'signOut'],
    mutationFn: () => authCall(authClient.signOut()),
    onSuccess: () => {
      signedOut()
      void navigate({ to: '/signin' })
    },
    meta: { failure: t('appMenu.notSignedOut') },
  })

  if (!user) return null
  const close = () => setOpen(false)

  const signOut = () => {
    close()
    void signOutMutation.run()
  }

  const links: { to: '/app' | '/app/settings'; search?: SettingsSearch; label: string }[] = [
    { to: '/app', label: t('appMenu.home') },
    { to: '/app/settings', search: {}, label: t('appMenu.settings') },
    ...(managesMembers
      ? [
          {
            to: '/app/settings' as const,
            search: { section: 'members' as const },
            label: t('appMenu.members'),
          },
        ]
      : []),
    ...(can({ billing: ['read'] })
      ? [
          {
            to: '/app/settings' as const,
            search: { section: 'billing' as const },
            label: t('appMenu.billing'),
          },
        ]
      : []),
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={t('appMenu.accountMenu')}
          aria-controls="app-menu"
        >
          <Avatar>
            <AvatarFallback>{initialOf(name)}</AvatarFallback>
          </Avatar>
        </Button>
      </PopoverTrigger>
      <PopoverContent id="app-menu" align="end" className="w-64 p-2">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">
            {t('shell.usage', {
              organization: user.organization?.name,
              plan: user.plan ? planLabel(user.plan) : '',
            })}
          </p>
        </div>
        <Separator className="my-1" />
        <ul aria-label={t('appMenu.yourOrganization')} className="flex flex-col">
          {links.map((link) => (
            <li key={link.label}>
              <Button asChild variant="ghost" size="sm" className="w-full justify-start">
                <Link
                  to={link.to}
                  search={link.search}
                  activeOptions={{ exact: true }}
                  onClick={close}
                >
                  {link.label}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
        <Separator className="my-1" />
        <ThemeSwitcher />
        <Separator className="my-1" />
        <ul aria-label={t('appMenu.more')} className="flex flex-col">
          <li>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
              {t('appMenu.signOut')}
            </Button>
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  )
}
