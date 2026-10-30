// Shared address rules (emails, slugs, organization names, time zones). Pure TS; runs in web and api.
// Filled in by the auth-onboarding and organizations-members features.
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}
