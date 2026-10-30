import { type APIRequestContext, expect } from '@playwright/test'

import { MAILPIT_ORIGIN } from './origins'

const MAGIC_LINK = /https?:\/\/\S+\/api\/auth\/magic-link\/verify\S+/

/** The text of the newest mail Mailpit received for `email`, if any. */
async function newestText(request: APIRequestContext, email: string) {
  const search = await request.get(`${MAILPIT_ORIGIN}/api/v1/search`, {
    params: { query: `to:"${email}"`, limit: '1' },
  })
  const [newest] = ((await search.json()) as { messages: { ID: string }[] }).messages
  if (!newest) return undefined
  const message = await request.get(`${MAILPIT_ORIGIN}/api/v1/message/${newest.ID}`)
  return ((await message.json()) as { Text: string }).Text
}

/** The newest magic link mailed to `email`, waiting for it to arrive. */
export async function magicLinkFor(request: APIRequestContext, email: string): Promise<string> {
  let link: string | undefined
  await expect
    .poll(async () => {
      link = (await newestText(request, email))?.match(MAGIC_LINK)?.[0]
      return link
    })
    .toBeTruthy()
  return link!
}

/** Deletes every mail Mailpit received for `email`. */
export async function clearMailFor(request: APIRequestContext, email: string) {
  const res = await request.delete(`${MAILPIT_ORIGIN}/api/v1/search`, {
    params: { query: `to:"${email}"` },
  })
  expect(res.ok()).toBe(true)
}
