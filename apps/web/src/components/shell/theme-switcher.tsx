import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group'

const THEMES = [
  { value: 'light', label: 'appMenu.themeLight', Icon: SunIcon },
  { value: 'dark', label: 'appMenu.themeDark', Icon: MoonIcon },
  { value: 'system', label: 'appMenu.themeSystem', Icon: MonitorIcon },
] as const

export function ThemeSwitcher() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const labelId = useId()

  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1">
      <span id={labelId} className="text-sm">
        {t('appMenu.theme')}
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-labelledby={labelId}
        value={theme ?? 'system'}
        onValueChange={(value) => {
          if (value) setTheme(value)
        }}
      >
        {THEMES.map(({ value, label, Icon }) => (
          <ToggleGroupItem key={value} value={value} aria-label={t(label)} title={t(label)}>
            <Icon />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
