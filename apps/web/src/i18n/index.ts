import { ACCOUNT_LANGUAGES, type AccountLanguage, isAccountLanguage } from '@arrakit/address'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { en, loadEs } from './resources'

export const LANGUAGES = ACCOUNT_LANGUAGES
export type Language = AccountLanguage

export const STORED_LANGUAGE_KEY = 'arrakit.lang'

const loaders: Record<Language, () => Promise<Record<string, unknown>>> = {
  en: async () => en,
  es: loadEs,
}

export const isLanguage = isAccountLanguage

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: [...LANGUAGES],
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
  initAsync: false,
})

function remember(lang: Language): void {
  try {
    window.localStorage.setItem(STORED_LANGUAGE_KEY, lang)
  } catch {
    return
  }
}

async function activate(lang: Language): Promise<void> {
  if (!i18n.hasResourceBundle(lang, 'translation')) {
    i18n.addResourceBundle(lang, 'translation', await loaders[lang]())
  }
  if (i18n.language === lang) return
  await i18n.changeLanguage(lang)
  if (typeof document !== 'undefined') document.documentElement.lang = lang
  if (typeof window !== 'undefined') remember(lang)
}

let switching: Promise<void> = Promise.resolve()

/**
 * Loads `lang` first, then makes it the active language, sets `<html lang>` and remembers it in
 * this browser. Switches run one after the other, so the last one requested wins.
 */
export function loadLanguage(lang: Language): Promise<void> {
  switching = switching.catch(() => undefined).then(() => activate(lang))
  return switching
}

/** Resolves once every switch asked so far has finished, whether it worked or not. */
export function languageSettled(): Promise<void> {
  return switching.catch(() => undefined)
}

function storedLanguage(win: Pick<Window, 'localStorage'>): string | null {
  try {
    return win.localStorage.getItem(STORED_LANGUAGE_KEY)
  } catch {
    return null
  }
}

/** The language this browser last used, else the browser's own, else English. */
export function initialLanguage(
  win: Pick<Window, 'localStorage' | 'navigator'> = window,
): Language {
  const stored = storedLanguage(win)
  if (isLanguage(stored)) return stored
  const browser = win.navigator?.language?.slice(0, 2)
  return isLanguage(browser) ? browser : 'en'
}

/** Translate outside React (toasts, titles); reads the active language at call time. */
export function tr(key: string, params?: Record<string, unknown>): string {
  return i18n.t(key, params)
}

if (typeof window !== 'undefined') {
  loadLanguage(initialLanguage()).catch((err: unknown) =>
    console.error('[i18n] loading the initial language failed', err),
  )
}

export { i18n }
