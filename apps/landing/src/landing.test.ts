import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { describe, expect, it } from 'vitest'

import NotFound from './pages/404.astro'
import Index from './pages/index.astro'

const render = async (page: Parameters<AstroContainer['renderToString']>[0]) =>
  (await AstroContainer.create()).renderToString(page)

describe('front page', () => {
  it('links Pricing, Sign in and Get started into the app', async () => {
    const html = await render(Index)
    expect(html).toContain('href="https://app.example.com/pricing"')
    expect(html).toContain('href="https://app.example.com/signin"')
    expect(html).toContain('href="https://app.example.com/start"')
    expect(html).toContain('Get started')
  })

  it('names the product and shows the claim, the motto and the footer', async () => {
    const html = await render(Index)
    expect(html).toContain('<title>Arrakit</title>')
    expect(html).toContain('Nothing in excess.')
    expect(html).toMatch(/<b[^>]*>Your product<\/b> in one line,/)
    expect(html).toMatch(/<b[^>]*>the reason<\/b> people need it\./)
    expect(html).toContain('© Arrakit')
  })

  it('carries the search and link-preview metadata', async () => {
    const html = await render(Index)
    expect(html).toContain('rel="canonical" href="https://example.com/"')
    expect(html).toContain('property="og:image" content="https://example.com/og-card.png"')
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
    expect(html).toContain('href="/favicon.ico" sizes="48x48"')
  })
})

describe('404 page', () => {
  it('is not indexed and leads back home', async () => {
    const html = await render(NotFound)
    expect(html).toContain('name="robots" content="noindex"')
    expect(html).toContain('<title>Page not found · Arrakit</title>')
    expect(html).toContain('This page does not exist.')
    expect(html).toContain('href="/"')
  })
})
