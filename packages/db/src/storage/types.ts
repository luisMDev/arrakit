export interface StoredFile {
  /** Relative to the organization prefix. */
  path: string
}

export interface OrganizationFiles {
  /** `''` is the whole organization; otherwise the folder ends with exactly one `/`. */
  removePrefix(folder: string): Promise<void>
  list(folder: string): Promise<StoredFile[]>
}

export interface Storage {
  forOrganization(organizationId: string): OrganizationFiles
  /** HeadBucket on S3; throws when storage is down. */
  probe(signal?: AbortSignal): Promise<void>
  close(): Promise<void>
}
