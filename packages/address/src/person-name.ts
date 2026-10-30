/** The trimmed name, or the email's local part when the name is blank. */
export function personName(name: string | null | undefined, email: string): string {
  return name?.trim() || email.split('@')[0] || email
}
