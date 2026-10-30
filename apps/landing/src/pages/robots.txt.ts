import type { APIRoute } from 'astro'

import { robotsTxt } from '../lib/config'

export const GET: APIRoute = () =>
  new Response(robotsTxt(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
