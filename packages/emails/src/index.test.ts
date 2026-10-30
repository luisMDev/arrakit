import { describe, expect, it } from 'vitest'

import { APP_NAME, escapeHtml } from './index'

describe('emails package', () => {
  it('has the product name in one place', () => {
    expect(APP_NAME).toBe('Arrakit')
  })

  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    )
  })
})
