import { ACCOUNT_LANGUAGES, type AccountLanguage, isAccountLanguage } from '@arrakit/address'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

type Messages = { [key: string]: string | Messages }

function deepMerge(target: Messages, source: Messages): Messages {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    target[key] =
      typeof value === 'object' && typeof current === 'object'
        ? deepMerge({ ...current }, value)
        : value
  }
  return target
}

const mergeModules = (modules: Record<string, Messages>): Messages =>
  Object.keys(modules)
    .sort()
    .reduce<Messages>((all, path) => deepMerge(all, modules[path]!), {})

const enModules = import.meta.glob<Messages>('./locales/en/*.json', {
  eager: true,
  import: 'default',
})
const esModules = import.meta.glob<Messages>('./locales/es/*.json', { import: 'default' })

/** English is bundled (fallback). */
export const en: Messages = mergeModules(enModules)

/** Spanish is loaded on first use. */
export async function loadEs(): Promise<Messages> {
  const entries = await Promise.all(
    Object.entries(esModules).map(async ([path, load]) => [path, await load()] as const),
  )
  return mergeModules(Object.fromEntries(entries))
}

export const STORED_LANGUAGE_KEY = 'arrakit.lang'

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: [...ACCOUNT_LANGUAGES],
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
  initAsync: false,
})

function remember(lang: AccountLanguage): void {
  try {
    window.localStorage.setItem(STORED_LANGUAGE_KEY, lang)
  } catch {
    return
  }
}

async function activate(lang: AccountLanguage): Promise<void> {
  if (!i18n.hasResourceBundle(lang, 'translation')) {
    i18n.addResourceBundle(lang, 'translation', lang === 'en' ? en : await loadEs())
  }
  if (i18n.language === lang) return
  await i18n.changeLanguage(lang)
  document.documentElement.lang = lang
  remember(lang)
}

let switching: Promise<void> = Promise.resolve()

/**
 * Loads `lang` first, then makes it the active language, sets `<html lang>` and remembers it in
 * this browser. Switches run one after the other, so the last one requested wins.
 */
export function loadLanguage(lang: AccountLanguage): Promise<void> {
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
): AccountLanguage {
  const stored = storedLanguage(win)
  if (isAccountLanguage(stored)) return stored
  const browser = win.navigator?.language?.slice(0, 2)
  return isAccountLanguage(browser) ? browser : 'en'
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
