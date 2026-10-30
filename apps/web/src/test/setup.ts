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

afterEach(() => {
  cleanup()
})
