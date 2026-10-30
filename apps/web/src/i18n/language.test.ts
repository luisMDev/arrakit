import { afterEach, describe, expect, it } from 'vitest'

import { i18n, initialLanguage, loadLanguage, STORED_LANGUAGE_KEY, tr } from './index'

function browser(language: string, stored: string | null = null, blocked = false) {
  return {
    navigator: { language } as Navigator,
    localStorage: {
      getItem: () => {
        if (blocked) throw new DOMException('blocked', 'SecurityError')
        return stored
      },
    } as unknown as Storage,
  }
}

describe('language', () => {
  afterEach(async () => {
    await loadLanguage('en')
    window.localStorage.clear()
  })

  it('switches every text, sets <html lang> and remembers the choice', async () => {
    expect(tr('home.settings')).toBe('Settings')
    await loadLanguage('es')
    expect(i18n.language).toBe('es')
    expect(tr('home.settings')).toBe('Ajustes')
    expect(document.documentElement.lang).toBe('es')
    expect(window.localStorage.getItem(STORED_LANGUAGE_KEY)).toBe('es')
  })

  it('applies switches in the order asked', async () => {
    void loadLanguage('es')
    await loadLanguage('en')
    expect(i18n.language).toBe('en')
  })

  it('falls back to English for a key Spanish lacks', async () => {
    i18n.addResource('en', 'translation', 'only.inEnglish', 'English only')
    await loadLanguage('es')
    expect(tr('only.inEnglish')).toBe('English only')
  })

  it.each([
    ['es-ES', null, 'es'],
    ['fr-FR', null, 'en'],
    ['en-US', null, 'en'],
    ['fr-FR', 'es', 'es'],
    ['es-ES', 'en', 'en'],
    ['es-ES', 'de', 'es'],
  ])('starts a browser in %s with %s stored in %s', (language, stored, expected) => {
    expect(initialLanguage(browser(language, stored))).toBe(expected)
  })

  it('starts from the browser language when storage is blocked', () => {
    expect(initialLanguage(browser('es-ES', null, true))).toBe('es')
  })
})
