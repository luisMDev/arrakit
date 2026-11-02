import type { AnyRoute, AnyRouter } from '@tanstack/react-router'

import { APP_NAME } from '#/config'
import { i18n } from '#/i18n'

/** `head()` for a route titled `<APP_NAME> · app.titles.<key>`, in the language active then. */
export const titled = (key: string) => () => ({
  meta: [{ title: `${APP_NAME} · ${i18n.t(`app.titles.${key}`)}` }],
})

/** The title the deepest titled match's `head()` gives now. */
async function currentTitle(router: AnyRouter): Promise<string | undefined> {
  const { matches } = router.state
  for (const match of [...matches].reverse()) {
    const route = (router.routesById as Record<string, AnyRoute>)[match.routeId]
    const head = route?.options.head
    if (!head) continue
    const { meta } = (await head({
      ssr: router.options.ssr,
      matches,
      match,
      params: match.params,
      loaderData: match.loaderData,
    })) ?? { meta: undefined }
    const title = meta?.find((tag) => tag?.title)?.title
    if (title) return title
  }
  return undefined
}

/**
 * Retitles the page when the language changes. Only `document.title` is rewritten: the router is
 * not reloaded, and its `<HeadContent>` keeps its tags until the next navigation recomputes them.
 */
export function retitleOnLanguageChange(router: AnyRouter): () => void {
  const retitle = () =>
    void currentTitle(router).then((title) => {
      if (title) document.title = title
    })
  i18n.on('languageChanged', retitle)
  return () => i18n.off('languageChanged', retitle)
}
