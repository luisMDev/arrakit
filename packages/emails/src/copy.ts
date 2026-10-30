export type CopyLang = 'en' | 'es'

/** `count(1, 'day')` -> "1 day", `count(3, 'day')` -> "3 days". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** First word of a display name. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}
