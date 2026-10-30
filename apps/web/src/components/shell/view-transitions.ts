import type { RouterOptions } from '@tanstack/react-router'

/**
 * Every navigation runs inside `document.startViewTransition` where the browser has it, so the
 * page cross-fades. The site header and the app bar carry their own `view-transition-name`, which
 * keeps them out of the fade.
 */
export const viewTransitionRouterOptions = {
  defaultViewTransition: true,
} as const satisfies Pick<RouterOptions<never, 'never'>, 'defaultViewTransition'>
