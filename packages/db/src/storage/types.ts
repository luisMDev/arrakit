export interface StoredFile {
  /** Relative to the organization prefix. */
  path: string
}

export interface ObjectHead {
  size: number
  contentType: string
}

export interface PresignedUpload {
  url: string
  /** Headers the upload must send unchanged; they are part of the signature. */
  headers: Record<string, string>
  expiresAt: Date
}

export interface PresignedDownload {
  url: string
  expiresAt: Date
}

export interface PresignPutOptions {
  contentType: string
  contentLength: number
  expiresInSeconds: number
}

export interface PresignGetOptions {
  /** The file name the browser saves the download as. */
  downloadName: string
  expiresInSeconds: number
}

/** Paths are relative to the organization prefix; a file path never ends with `/`. */
export interface OrganizationObjects {
  /** `''` is the whole organization; otherwise the folder ends with exactly one `/`. */
  removePrefix(folder: string): Promise<void>
  list(folder: string): Promise<StoredFile[]>
  presignPut(path: string, options: PresignPutOptions): Promise<PresignedUpload>
  presignGet(path: string, options: PresignGetOptions): Promise<PresignedDownload>
  /** Undefined when the object does not exist. */
  head(path: string): Promise<ObjectHead | undefined>
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  /** Succeeds when the object is already gone. */
  remove(path: string): Promise<void>
}

export interface Storage {
  forOrganization(organizationId: string): OrganizationObjects
  /** HeadBucket on S3; throws when storage is down. */
  probe(signal?: AbortSignal): Promise<void>
  close(): Promise<void>
}
