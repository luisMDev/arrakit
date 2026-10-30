import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// The full monorepo test run shares the CPU with PGlite suites; the 1 s default is too tight.
configure({ asyncUtilTimeout: 5_000 })

// Radix primitives (Select, Popover, ...) observe their size; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

// next-themes follows prefers-color-scheme; jsdom has no matchMedia.
globalThis.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList

// Radix Select and Dialog call these; jsdom lacks them or logs "not implemented".
if (typeof window !== 'undefined') {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.releasePointerCapture ??= () => undefined
  proto.setPointerCapture ??= () => undefined
  proto.scrollIntoView ??= () => undefined
  window.scrollTo = () => undefined
}

afterEach(() => {
  cleanup()
})
