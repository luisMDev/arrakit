import { afterEach, describe, expect, it, vi } from 'vitest'

import { i18n, initialLanguage, languageSettled, loadLanguage, STORED_LANGUAGE_KEY } from './index'

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
    expect(i18n.t('home.settings')).toBe('Settings')
    await loadLanguage('es')
    expect(i18n.language).toBe('es')
    expect(i18n.t('home.settings')).toBe('Ajustes')
    expect(document.documentElement.lang).toBe('es')
    expect(window.localStorage.getItem(STORED_LANGUAGE_KEY)).toBe('es')
  })

  it('applies switches in the order asked', async () => {
    void loadLanguage('es')
    await loadLanguage('en')
    expect(i18n.language).toBe('en')
  })

  it('settles once every switch asked so far has finished, even a failed one', async () => {
    void loadLanguage('es')
    await languageSettled()
    expect(i18n.language).toBe('es')
    const failing = vi
      .spyOn(i18n, 'changeLanguage')
      .mockRejectedValueOnce(new TypeError('Importing a module script failed.'))
    const failed = loadLanguage('en')
    await expect(languageSettled()).resolves.toBeUndefined()
    await expect(failed).rejects.toThrow(TypeError)
    expect(i18n.language).toBe('es')
    failing.mockRestore()
  })

  it('falls back to English for a key Spanish lacks', async () => {
    i18n.addResource('en', 'translation', 'only.inEnglish', 'English only')
    await loadLanguage('es')
    expect(i18n.t('only.inEnglish')).toBe('English only')
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
