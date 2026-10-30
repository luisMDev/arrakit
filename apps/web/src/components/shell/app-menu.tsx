import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SettingsSearch } from '#/components/settings/settings-page'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Separator } from '#/components/ui/separator'
import { authClient } from '#/lib/auth-client'
import { initialOf, useCurrentUser } from '#/lib/current-user'
import { useApiMutation } from '#/lib/use-api-mutation'

import { ThemeSwitcher } from './theme-switcher'

async function signOutOrThrow(): Promise<void> {
  const result = await authClient.signOut()
  if (result.error) throw Object.assign(new Error('sign-out failed'), result.error)
}

/**
 * A disclosure (a button and the links it shows), not an ARIA menu. Escape, a click outside and
 * a click on a link close it. Members and Billing show to those their role lets in.
 */
export function AppMenu() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, name, can, managesMembers, planLabel, signedOut } = useCurrentUser()
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const signOutMutation = useApiMutation({
    mutationKey: ['auth', 'signOut'],
    mutationFn: signOutOrThrow,
    onSuccess: () => {
      signedOut()
      void navigate({ to: '/signin' })
    },
    meta: { failure: t('appMenu.notSignedOut') },
  })

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

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
    <div ref={host} className="relative">
      <Button
        ref={button}
        variant="ghost"
        size="icon"
        className="rounded-full"
        aria-label={t('appMenu.accountMenu')}
        aria-controls="app-menu"
        aria-expanded={open ? 'true' : 'false'}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <Avatar>
          <AvatarFallback>{initialOf(name)}</AvatarFallback>
        </Avatar>
      </Button>
      {open ? (
        <div
          id="app-menu"
          className="absolute right-0 z-50 mt-2 w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
        >
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">
              {t('shell.usage', { organization: user.organization?.name, plan: planLabel })}
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
        </div>
      ) : null}
    </div>
  )
}
