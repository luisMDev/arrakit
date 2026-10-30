import { APP_NAME } from '#/config'
import { tr } from '#/i18n'

/** `<APP_NAME> · <translated title>` in the language active at navigation time. */
export function pageTitle(key: string): string {
  return `${APP_NAME} · ${tr(key)}`
}

/** `head()` for a route whose title is `app.titles.<key>`. */
export const titled = (key: string) => () => ({ meta: [{ title: pageTitle(`app.titles.${key}`) }] })
