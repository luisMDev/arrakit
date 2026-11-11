import { describe, expect, it } from 'vitest'

import { ARTIFACT_CSP, ARTIFACT_SANDBOX, sandboxedDocument } from './sandboxed-document'

const POLICY = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`

describe('sandboxedDocument', () => {
  it('puts the policy first in the head', () => {
    expect(sandboxedDocument('<!doctype html><html lang="en"><head><title>Q3</title></head>')).toBe(
      `<!doctype html><html lang="en"><head>${POLICY}<title>Q3</title></head>`,
    )
    expect(sandboxedDocument('<HEAD data-x="1"><style></style>')).toBe(
      `<HEAD data-x="1">${POLICY}<style></style>`,
    )
  })

  it('falls back to the html tag, then the doctype, then the start', () => {
    expect(sandboxedDocument('<html><body>hi</body></html>')).toBe(
      `<html>${POLICY}<body>hi</body></html>`,
    )
    expect(sandboxedDocument('<!DOCTYPE html>\n<p>hi</p>')).toBe(
      `<!DOCTYPE html>${POLICY}\n<p>hi</p>`,
    )
    expect(sandboxedDocument('<p>hi</p>')).toBe(`${POLICY}<p>hi</p>`)
  })

  it('does not take a header element for the head', () => {
    expect(sandboxedDocument('<header>Top</header>')).toBe(`${POLICY}<header>Top</header>`)
  })

  it('cuts the page off the network and its forms', () => {
    expect(ARTIFACT_CSP).toContain("default-src 'none'")
    expect(ARTIFACT_CSP).toContain("connect-src 'none'")
    expect(ARTIFACT_CSP).toContain("form-action 'none'")
    expect(ARTIFACT_CSP).toContain("base-uri 'none'")
  })

  it('never shares the app origin', () => {
    expect(ARTIFACT_SANDBOX.split(' ')).toContain('allow-scripts')
    expect(ARTIFACT_SANDBOX).not.toContain('allow-same-origin')
    expect(ARTIFACT_SANDBOX).not.toContain('allow-top-navigation')
  })
})
