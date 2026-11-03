import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { planLabel } from '#/components/billing/plan-copy'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { Separator } from '#/components/ui/separator'
import { authCall } from '#/lib/auth-call'
import { authClient } from '#/lib/auth-client'
import { initialOf, useCurrentUser } from '#/lib/current-user'
import { useApiMutation } from '#/lib/use-api-mutation'

import { ThemeSwitcher } from './theme-switcher'

/** The account menu: a popover with the person, the theme and sign out. */
export function AppMenu() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, name, signedOut } = useCurrentUser()
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
