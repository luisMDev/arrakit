import { fileExtension } from './files'
import type { Plan } from './index'

export const ARTIFACT_FORMATS = ['html', 'markdown'] as const
export type ArtifactFormat = (typeof ARTIFACT_FORMATS)[number]

export const ARTIFACT_TITLE_MAX = 200

export interface ArtifactPolicy {
  /** The most UTF-8 bytes one version's content may take. */
  maxBytes: number
}

const REPORTS: ArtifactPolicy = { maxBytes: 2 * 1_000_000 }

export const ARTIFACT_POLICIES: Record<Plan, ArtifactPolicy> = {
  free: REPORTS,
  pro: REPORTS,
  team: REPORTS,
  internal: REPORTS,
}

export const artifactPolicyFor = (plan: Plan): ArtifactPolicy => ARTIFACT_POLICIES[plan]

export const isArtifactFormat = (value: unknown): value is ArtifactFormat =>
  (ARTIFACT_FORMATS as readonly unknown[]).includes(value)

const FORMAT_BY_EXTENSION: Readonly<Record<string, ArtifactFormat>> = {
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
}

/** The format a file named `name` holds as an artifact; undefined when it holds none. */
export function artifactFormatOf(name: string): ArtifactFormat | undefined {
  const extension = fileExtension(name)
  return extension && Object.hasOwn(FORMAT_BY_EXTENSION, extension)
    ? FORMAT_BY_EXTENSION[extension]
    : undefined
}

/** The extension an artifact's source is downloaded with. */
export const ARTIFACT_EXTENSIONS: Record<ArtifactFormat, string> = { html: 'html', markdown: 'md' }

/** The UTF-8 size of `content`, which the policy limits. */
export const contentBytes = (content: string): number =>
  new TextEncoder().encode(content).byteLength

/** True when `content` fits one version under `policy`. */
export const fitsArtifact = (content: string, policy: ArtifactPolicy): boolean =>
  contentBytes(content) <= policy.maxBytes
