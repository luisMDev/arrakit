export const ACCOUNT_LANGUAGES = ['en', 'es'] as const
export type AccountLanguage = (typeof ACCOUNT_LANGUAGES)[number]

export const isAccountLanguage = (value: unknown): value is AccountLanguage =>
  (ACCOUNT_LANGUAGES as readonly unknown[]).includes(value)
