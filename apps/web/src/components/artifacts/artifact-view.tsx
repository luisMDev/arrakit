import type { ArtifactFormat } from '@arrakit/plans'

import { ArtifactMarkdown } from './artifact-markdown'
import { ARTIFACT_SANDBOX, sandboxedDocument } from './sandboxed-document'

/** One version of an artifact: HTML runs in a sandboxed frame, Markdown reads as a document. */
export function ArtifactView({
  title,
  format,
  content,
}: {
  title: string
  format: ArtifactFormat
  content: string
}) {
  if (format === 'markdown') return <ArtifactMarkdown content={content} />
  return (
    <iframe
      title={title}
      sandbox={ARTIFACT_SANDBOX}
      referrerPolicy="no-referrer"
      srcDoc={sandboxedDocument(content)}
      className="h-[75vh] w-full rounded-lg border bg-white"
    />
  )
}
