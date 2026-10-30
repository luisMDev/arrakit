const EMAIL = /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** An address we can write to: a dot in the domain and a TLD of at least two letters. */
export const isWorkEmail = (email: string) => EMAIL.test(normalizeEmail(email))
