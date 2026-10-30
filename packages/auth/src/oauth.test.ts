import { describe, expect, it } from 'vitest'

import { restoreNavigation } from './oauth'

const URL_ = 'http://localhost:5200/api/auth/oauth2/authorize?client_id=a'

describe('restoreNavigation', () => {
  it('marks a proxied page navigation as a navigation again', () => {
    const request = new Request(URL_, {
      headers: { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'cors', cookie: 'a=1' },
    })
    const restored = restoreNavigation(request)
    expect(restored?.headers.get('sec-fetch-mode')).toBe('navigate')
    expect(restored?.headers.get('cookie')).toBe('a=1')
    expect(restored?.url).toBe(URL_)
  })

  it('leaves script fetches, real navigations and other methods alone', () => {
    const fetchFromScript = new Request(URL_, {
      headers: { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors' },
    })
    const navigation = new Request(URL_, {
      headers: { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' },
    })
    const post = new Request(URL_, {
      method: 'POST',
      body: '{}',
      headers: { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'cors' },
    })
    expect(restoreNavigation(fetchFromScript)).toBeUndefined()
    expect(restoreNavigation(navigation)).toBeUndefined()
    expect(restoreNavigation(post)).toBeUndefined()
    expect(restoreNavigation(new Request(URL_))).toBeUndefined()
  })
})
