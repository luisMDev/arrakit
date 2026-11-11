const key = (organizationId: string) => `arrakit.workspace.${organizationId}`

/** Remembers, on this device, the workspace the person has open in an organization. */
export function rememberWorkspace(organizationId: string, workspaceId: string): void {
  try {
    localStorage.setItem(key(organizationId), workspaceId)
  } catch {
    // Storage is optional: without it Home opens the organization's first workspace.
  }
}

/** The workspace last opened on this device in an organization, if storage has one. */
export function lastWorkspace(organizationId: string): string | null {
  try {
    return localStorage.getItem(key(organizationId))
  } catch {
    return null
  }
}
