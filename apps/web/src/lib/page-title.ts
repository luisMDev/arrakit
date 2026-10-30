import { APP_NAME } from '#/config'
import { tr } from '#/i18n'

/** `head()` for a route titled `<APP_NAME> · app.titles.<key>`, in the language active then. */
export const titled = (key: string) => () => ({
  meta: [{ title: `${APP_NAME} · ${tr(`app.titles.${key}`)}` }],
})
