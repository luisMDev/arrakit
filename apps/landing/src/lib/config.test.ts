import { describe, expect, it } from 'vitest'

import { appLink, robotsTxt, siteLink } from './config'

describe('appLink', () => {
  it('joins the app origin and a path', () => {
    expect(appLink('/pricing')).toMatch(/^https?:\/\/[^/]+\/pricing$/)
  })

  it.each(['/pricing', '/signin', '/signup'])('points %s at the app host', (path) => {
    expect(appLink(path, 'https://app.acme.test/')).toBe(`https://app.acme.test${path}`)
  })
})

describe('siteLink', () => {
  it('joins the site origin and a path', () => {
    expect(siteLink('/og-card.png', 'https://acme.test/')).toBe('https://acme.test/og-card.png')
  })
})

describe('robotsTxt', () => {
  it('allows everything and names the sitemap', () => {
    const robots = robotsTxt('https://acme.test')
    expect(robots).toContain('User-agent: *\nAllow: /')
    expect(robots).toContain('Sitemap: https://acme.test/sitemap-index.xml')
    expect(robots).not.toMatch(/Disallow/)
  })
})
