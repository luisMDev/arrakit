import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ReactNode } from 'react'

const STORED_THEME_KEY = 'arrakit.theme'

/** Light, dark or the system's; toggles the `.dark` class on <html> and remembers the choice. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey={STORED_THEME_KEY}
    >
      {children}
    </NextThemesProvider>
  )
}
