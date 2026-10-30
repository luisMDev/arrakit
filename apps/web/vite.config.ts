import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { apiOriginFrom, apiProxyRules } from './src/lib/api-proxy'

// The API (apps/api) serves /api/* and the OAuth metadata under /.well-known/oauth-*.
// Web and API must look like one site so the Better Auth cookie is first-party, so the
// web server (Nitro, in dev and in the production build) proxies those paths to API_ORIGIN.
// Vite's server.proxy is not used: the TanStack Start/Nitro dev middleware answers first.
// The rules set xfwd and drop the incoming x-forwarded-for so the API sees exactly one client IP.
const apiOrigin = apiOriginFrom(process.env.API_ORIGIN)

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { port: 4200, strictPort: true },
  preview: { port: 4200, strictPort: true },
  plugins: [
    nitro({
      routeRules: apiProxyRules(apiOrigin),
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
