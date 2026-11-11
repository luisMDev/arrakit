const CDNS = ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com']

/**
 * What an artifact page may load: inline code and the public CDNs, never the network
 * (`connect-src`, forms, frames). The frame's sandbox already gives it an opaque origin.
 */
export const ARTIFACT_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' ${CDNS.join(' ')}`,
  `style-src 'unsafe-inline' https://fonts.googleapis.com ${CDNS.join(' ')}`,
  `font-src data: https://fonts.gstatic.com ${CDNS.join(' ')}`,
  'img-src data: blob: https:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ')

/** The sandbox an artifact frame runs in; never `allow-same-origin`. */
export const ARTIFACT_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox'

const POLICY_TAG = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`

const HEAD_OPEN = /<head(\s[^>]*)?>/i
const HTML_OPEN = /<html(\s[^>]*)?>/i
const DOCTYPE = /^\s*<!doctype[^>]*>/i

/**
 * `html` with the artifact policy as the first thing in its head. A policy the page declares
 * itself can only narrow it: the browser enforces every policy it reads.
 */
export function sandboxedDocument(html: string): string {
  for (const tag of [HEAD_OPEN, HTML_OPEN, DOCTYPE]) {
    const match = tag.exec(html)
    if (match) {
      const end = match.index + match[0].length
      return `${html.slice(0, end)}${POLICY_TAG}${html.slice(end)}`
    }
  }
  return `${POLICY_TAG}${html}`
}
