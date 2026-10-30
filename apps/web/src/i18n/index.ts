import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'

// i18n (docs/spec/web-shell-landing.md section 6). `en` is bundled and is the fallback;
// `es` is lazy-loaded the first time it is used. Never switch before the target is loaded.
export const LANGUAGES = ['en', 'es'] as const
export type Language = (typeof LANGUAGES)[number]

const loaders: Record<Language, () => Promise<Record<string, unknown>>> = {
  en: async () => en,
  es: async () => (await import('./locales/es.json')).default,
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: [...LANGUAGES],
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
  initAsync: false,
})

/** Loads `lang` if needed, then makes it the active language. */
export async function loadLanguage(lang: Language): Promise<void> {
  if (!i18n.hasResourceBundle(lang, 'translation')) {
    i18n.addResourceBundle(lang, 'translation', await loaders[lang]())
  }
  if (i18n.language !== lang) await i18n.changeLanguage(lang)
}

/** Translate outside React (toasts, titles); reads the active language at call time. */
export function tr(key: string, params?: Record<string, unknown>): string {
  return i18n.t(key, params)
}

export { i18n }
