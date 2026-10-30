export const MCP_SERVER_NAME = 'arrakit'
export const MCP_SERVER_VERSION = '0.1.0'

export interface ConnectorCaller {
  userId: string
  organizationId: string
  role: 'owner' | 'admin' | 'member'
  organizationSlug: string
  clientId: string
  scopes: string[]
}
