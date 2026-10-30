// Landing configuration. Links to the app (Pricing, Sign in, Get started) use PUBLIC_APP_URL.
export const APP_NAME = 'Arrakit'
export const APP_URL: string = import.meta.env.PUBLIC_APP_URL ?? 'https://app.example.com'

export function appLink(path: string): string {
  return `${APP_URL.replace(/\/$/, '')}${path}`
}
