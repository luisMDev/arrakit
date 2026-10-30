const PLATFORM = /^Mozilla\/5\.0 \(([^)]*)\)/

const DEVICES: readonly [RegExp, string][] = [
  [/^iPhone$/, 'iPhone'],
  [/^iPad$/, 'iPad'],
  [/^Android\b/, 'Android phone'],
  [/^CrOS\b/, 'browser'],
  [/^Macintosh$/, 'Mac'],
  [/^Windows NT\b/, 'Windows PC'],
  [/^(X11|Linux\b)/, 'Linux computer'],
]

/** The device a user agent names ("Mac", "iPhone"…), or "browser" when it names none. */
export function deviceName(userAgent: string | null | undefined): string {
  const tokens = PLATFORM.exec(userAgent ?? '')?.[1]
    ?.split(';')
    .map((token) => token.trim())
  for (const [pattern, name] of DEVICES) {
    if (tokens?.some((token) => pattern.test(token))) return name
  }
  return 'browser'
}
