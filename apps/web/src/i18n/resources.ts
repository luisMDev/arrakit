export type Messages = { [key: string]: string | Messages }

export function deepMerge(target: Messages, source: Messages): Messages {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    target[key] =
      typeof value === 'object' && typeof current === 'object'
        ? deepMerge({ ...current }, value)
        : value
  }
  return target
}

export const mergeModules = (modules: Record<string, Messages>): Messages =>
  Object.keys(modules)
    .sort()
    .reduce<Messages>((all, path) => deepMerge(all, modules[path]!), {})

const enModules = import.meta.glob<Messages>('./locales/en/*.json', {
  eager: true,
  import: 'default',
})
const esModules = import.meta.glob<Messages>('./locales/es/*.json', { import: 'default' })

/** English is bundled (fallback). */
export const en: Messages = mergeModules(enModules)

/** Spanish is loaded on first use. */
export async function loadEs(): Promise<Messages> {
  const entries = await Promise.all(
    Object.entries(esModules).map(async ([path, load]) => [path, await load()] as const),
  )
  return mergeModules(Object.fromEntries(entries))
}
