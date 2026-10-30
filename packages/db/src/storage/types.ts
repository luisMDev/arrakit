export interface StoredFile {
  /** Relative to the organization prefix. */
  path: string
  size: number
  /** ISO timestamp. */
  modifiedAt: string
}

export interface OrganizationFiles {
  putUrl(name: string, options?: { contentType?: string; expiresIn?: number }): Promise<string>
  put(name: string, bytes: Uint8Array, contentType: string): Promise<void>
  /** FileNotFoundError for a missing key. */
  get(name: string): Promise<Uint8Array>
  copy(from: string, to: string): Promise<void>
  getUrl(name: string, options?: { expiresIn?: number }): Promise<string>
  /** Missing names are fine. */
  remove(names: string[]): Promise<void>
  removePrefix(folder: string): Promise<void>
  list(folder: string): Promise<StoredFile[]>
}

export interface Storage {
  readonly kind: 's3' | 'local' | 'memory'
  forOrganization(organizationId: string): OrganizationFiles
  /** HeadBucket (S3) or a directory access check; throws when storage is down. */
  probe(signal?: AbortSignal): Promise<void>
  close(): Promise<void>
}
