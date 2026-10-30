import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { apiProxiedPaths } from './src/lib/api-proxy'

// The API (apps/api) serves /api/* and the OAuth metadata under /.well-known/oauth-*.
// Web and API must look like one site so the Better Auth cookie is first-party, so the
// web server (Nitro, in dev and in the production build) proxies those paths to API_ORIGIN,
// read on every request by src/server/api-proxy-handler.ts.
// Vite's server.proxy is not used: the TanStack Start/Nitro dev middleware answers first.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    port: 5200,
    strictPort: true,
    // Playwright sets E2E=1: a client that aborts mid-upload makes Nitro's dev middleware report
    // "Internal server error: aborted", and Vite's error overlay would then cover the page.
    hmr: { overlay: process.env.E2E !== '1' },
  },
  preview: { port: 5200, strictPort: true },
  plugins: [
    nitro({
      handlers: apiProxiedPaths.map((path) => ({
        route: `${path}/**`,
        handler: fileURLToPath(new URL('./src/server/api-proxy-handler.ts', import.meta.url)),
      })),
      rolldownConfig: {
        onwarn(warning, warn) {
          // Radix, TanStack and sonner ship "use client" directives; harmless in the server bundle.
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
          warn(warning)
        },
      },
    }),
    tailwindcss(),
    tanstackStart({ router: { routeFileIgnorePattern: String.raw`\.(test|spec)\.tsx?$` } }),
    viteReact(),
  ],
})
