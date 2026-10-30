// @ts-check
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'

// Static marketing site. PUBLIC_SITE_URL is the canonical origin (og:url, sitemap).
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? 'https://example.com',
  integrations: [sitemap()],
  vite: { plugins: [tailwindcss()] },
})
