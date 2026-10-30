export const APP_NAME: string = import.meta.env.VITE_APP_NAME ?? 'Arrakit'
export const SITE_URL: string = import.meta.env.VITE_SITE_URL ?? 'https://example.com'

export const TERMS_URL = `${SITE_URL.replace(/\/$/, '')}/terms`
export const PRIVACY_URL = `${SITE_URL.replace(/\/$/, '')}/privacy`

/** Plausible-compatible analytics; off unless both variables are set. */
export const ANALYTICS: { src: string; domain: string } | null =
  import.meta.env.VITE_ANALYTICS_SRC && import.meta.env.VITE_ANALYTICS_DOMAIN
    ? { src: import.meta.env.VITE_ANALYTICS_SRC, domain: import.meta.env.VITE_ANALYTICS_DOMAIN }
    : null
