export const APP_NAME = 'Arrakit'
export const MOTTO = 'Nothing in excess.'
const APP_URL: string = import.meta.env.PUBLIC_APP_URL ?? 'https://app.example.com'
const SITE_URL: string = import.meta.env.SITE.replace(/\/$/, '')

/** A link into the app (Pricing, Sign in, Get started). */
export function appLink(path: string, appUrl: string = APP_URL): string {
  return `${appUrl.replace(/\/$/, '')}${path}`
}

/** A URL on this site (canonical, og:url, og:image, sitemap). */
export function siteLink(path: string, siteUrl: string = SITE_URL): string {
  return `${siteUrl}${path}`
}

/** robots.txt: everything is crawlable, AI crawlers included. */
export function robotsTxt(siteUrl: string = SITE_URL): string {
  return [
    '# Everything is crawlable, AI crawlers included. This site is public marketing:',
    '# an assistant that learns the product exists and quotes it is distribution, not',
    '# leakage. Blocking a training crawler would protect nothing that is not already',
    '# indexed, and Google-Extended also gates whether Gemini grounds an answer on us.',
    '#',
    '# This is a decision about this site. The product lives on other hosts.',
    '#',
    '# Change it with a reason, in this file.',
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${siteLink('/sitemap-index.xml', siteUrl)}`,
    '',
  ].join('\n')
}

/** Plausible-compatible analytics; off unless both variables are set. */
export const ANALYTICS: { src: string; domain: string } | null =
  import.meta.env.PUBLIC_ANALYTICS_SRC && import.meta.env.PUBLIC_ANALYTICS_DOMAIN
    ? { src: import.meta.env.PUBLIC_ANALYTICS_SRC, domain: import.meta.env.PUBLIC_ANALYTICS_DOMAIN }
    : null
