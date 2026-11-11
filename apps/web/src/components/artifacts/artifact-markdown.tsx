/** A Markdown artifact, shown as its source. */
export function ArtifactMarkdown({ content }: { content: string }) {
  return (
    <article className="rounded-lg border p-6">
      <pre className="font-sans text-sm whitespace-pre-wrap">{content}</pre>
    </article>
  )
}
