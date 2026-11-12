import type { RealtimeAccess } from '@arrakit/contract'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

import { client } from '#/lib/orpc'

/** What a joined channel reports; nothing is reported after `close()`. */
export interface ChannelHandlers {
  /** The channel is joined: signals from now on arrive, earlier ones may have been missed. */
  subscribed(): void
  message(payload: unknown): void
  /** The channel could not be joined or was dropped; it is gone and will not report again. */
  down(): void
}

/** A token closer than this to its expiry is replaced before the SDK uses it again. */
const REFRESH_BEFORE_MS = 60_000

let held: RealtimeAccess | null = null
let asking: Promise<RealtimeAccess | null> | undefined

/** Asks the API how to reach Realtime, one request at a time; the answer becomes the held access. */
function askAccess(): Promise<RealtimeAccess | null> {
  asking ??= client.realtime
    .access()
    .then((access) => {
      held = access
      return access
    })
    .finally(() => {
      asking = undefined
    })
  return asking
}

/** The SDK calls it on connect and on every heartbeat; its token must outlive the next call. */
async function accessToken(): Promise<string | null> {
  const current = held
  if (current && Date.parse(current.expiresAt) - Date.now() > REFRESH_BEFORE_MS) {
    return current.token
  }
  const fresh = await askAccess().catch(() => null)
  return (fresh ?? current)?.token ?? null
}

const clients = new Map<string, Promise<SupabaseClient>>()

function supabaseFor({ url, publishableKey }: RealtimeAccess): Promise<SupabaseClient> {
  const key = `${url} ${publishableKey}`
  let supabase = clients.get(key)
  if (!supabase) {
    supabase = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(url, publishableKey, { accessToken }),
    )
    supabase.catch(() => clients.delete(key))
    clients.set(key, supabase)
  }
  return supabase
}

// The SDK hands back a channel still being removed when one with the same topic is created, so a
// new channel waits for earlier removals to finish.
let removals: Promise<unknown> = Promise.resolve()

function remove(supabase: SupabaseClient, channel: RealtimeChannel) {
  removals = removals.then(() => supabase.removeChannel(channel)).catch(() => undefined)
}

/**
 * Joins the private Realtime channel `pickTopic` chooses among the caller's topics and hears
 * `event` on it. Each join asks the API for access again, so a refused or dropped channel comes
 * back with a fresh token. `close()` leaves the channel and silences every later report.
 */
export function joinChannel(
  pickTopic: (topics: RealtimeAccess['topics']) => string,
  event: string,
  handlers: ChannelHandlers,
): { close(): void } {
  let closed = false
  let joined: { supabase: SupabaseClient; channel: RealtimeChannel } | undefined

  const leave = () => {
    if (joined) remove(joined.supabase, joined.channel)
    joined = undefined
  }
  const down = () => {
    if (closed) return
    closed = true
    leave()
    handlers.down()
  }

  async function join() {
    const access = await askAccess().catch(() => null)
    if (closed) return
    if (!access) return down()
    const supabase = await supabaseFor(access)
    await supabase.realtime.setAuth()
    await removals
    if (closed) return
    const channel = supabase.channel(pickTopic(access.topics), { config: { private: true } })
    joined = { supabase, channel }
    channel
      .on('broadcast', { event }, (message) => {
        if (!closed) handlers.message(message.payload)
      })
      .subscribe((status) => {
        if (closed) return
        if (`${status}` === 'SUBSCRIBED') handlers.subscribed()
        else down()
      })
  }

  join().catch(down)
  return {
    close() {
      closed = true
      leave()
    },
  }
}
