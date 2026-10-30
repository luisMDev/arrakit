import { describe, expect, it } from 'vitest'

import { i18n, loadLanguage, tr } from './index'

describe('i18n', () => {
  it('starts in English and switches to Spanish after loading it', async () => {
    expect(tr('app.titles.home')).toBe('Home')
    await loadLanguage('es')
    expect(i18n.language).toBe('es')
    expect(tr('app.titles.home')).not.toBe('Home')
    await loadLanguage('en')
  })
})
