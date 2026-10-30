import { createStart } from '@tanstack/react-start'

// Screens render in the browser: the guards read the session cookie through same-origin /api
// calls, which the server-side render could not forward. The HTML shell is still server rendered.
export const startInstance = createStart(() => ({ defaultSsr: false }))
