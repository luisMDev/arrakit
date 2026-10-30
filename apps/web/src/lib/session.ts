export interface SessionPerson {
  email: string
  name: string
}

export async function session(): Promise<SessionPerson | null> {
  const res = await fetch('/api/auth/get-session', { credentials: 'include' })
  if (!res.ok)
    throw Object.assign(new Error(`get-session answered ${res.status}`), { status: res.status })
  const body = (await res.json()) as { user?: SessionPerson } | null
  return body?.user ? { email: body.user.email, name: body.user.name } : null
}
