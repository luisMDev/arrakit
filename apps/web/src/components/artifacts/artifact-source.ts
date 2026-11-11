import { ARTIFACT_EXTENSIONS, type ArtifactFormat } from '@arrakit/plans'

/** Saves `content` as `<title>.<extension of format>` on the person's device. */
export function downloadSource(title: string, format: ArtifactFormat, content: string): void {
  const type = format === 'html' ? 'text/html' : 'text/markdown'
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${title}.${ARTIFACT_EXTENSIONS[format]}`
  link.click()
  URL.revokeObjectURL(url)
}

/** A file name without its extension, as a title. */
export const titleOf = (fileName: string): string => fileName.replace(/\.[^.]+$/, '')
