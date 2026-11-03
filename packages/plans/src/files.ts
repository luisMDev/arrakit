import type { Plan } from './index'

/** The quota metric counts decimal gigabytes. */
export const BYTES_PER_GB = 1_000_000_000

export const FILE_NAME_MAX = 255

export interface FilePolicy {
  maxBytes: number
  /** Allowed extensions (lowercase, no dot) and the content type each is stored and served as. */
  types: Readonly<Record<string, string>>
}

const DOCUMENTS_AND_IMAGES: FilePolicy = {
  maxBytes: 50 * 1_000_000,
  types: {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odt: 'application/vnd.oasis.opendocument.text',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    odp: 'application/vnd.oasis.opendocument.presentation',
    rtf: 'application/rtf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  },
}

export const FILE_POLICIES: Record<Plan, FilePolicy> = {
  free: DOCUMENTS_AND_IMAGES,
  pro: DOCUMENTS_AND_IMAGES,
  team: DOCUMENTS_AND_IMAGES,
  internal: DOCUMENTS_AND_IMAGES,
}

export const filePolicyFor = (plan: Plan): FilePolicy => FILE_POLICIES[plan]

// eslint-disable-next-line no-control-regex
const UNUSABLE_NAME = /[\u0000-\u001f\u007f/\\]/

/** Lowercase, without the dot; undefined when the name has none. */
export function fileExtension(name: string): string | undefined {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return undefined
  return name.slice(dot + 1).toLowerCase()
}

export type FileRefusal = 'name' | 'type' | 'size'

export interface FileCandidate {
  name: string
  sizeBytes: number
}

/** Why `policy` refuses the file, or undefined when it accepts it. */
export function fileRefusal(file: FileCandidate, policy: FilePolicy): FileRefusal | undefined {
  const name = file.name.trim()
  if (name === '' || name !== file.name || name.length > FILE_NAME_MAX) return 'name'
  if (UNUSABLE_NAME.test(name) || name === '.' || name === '..') return 'name'
  const extension = fileExtension(name)
  if (!extension || !Object.hasOwn(policy.types, extension)) return 'type'
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) return 'size'
  if (file.sizeBytes > policy.maxBytes) return 'size'
  return undefined
}

/** The content type `policy` stores a file named `name` as; undefined when it is not allowed. */
export function contentTypeOf(name: string, policy: FilePolicy): string | undefined {
  const extension = fileExtension(name)
  return extension && Object.hasOwn(policy.types, extension) ? policy.types[extension] : undefined
}

/** The `storage_gb` level `bytes` take: whole gigabytes, rounded up. */
export const storageGbFor = (bytes: number): number => Math.ceil(bytes / BYTES_PER_GB)
