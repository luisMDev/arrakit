/** Leaves the app for another site: Stripe Checkout or portal, a sign-in provider, an OAuth client. */
export function leave(url: string): void {
  window.location.assign(url)
}
