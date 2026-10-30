const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86_400_000

function calendarDay(day: string): { year: number; month: string; date: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) throw new Error(`"${day}" is not a calendar day (YYYY-MM-DD)`)
  const [year, month, date] = match.slice(1).map(Number) as [number, number, number]
  return { year, month: MONTHS[month - 1] ?? '', date }
}

/** "Oct 4" */
export function shortDay(day: string): string {
  const { month, date } = calendarDay(day)
  return `${month} ${date}`
}

/** "Oct 4, 2027" */
export function fullDay(day: string): string {
  return `${shortDay(day)}, ${calendarDay(day).year}`
}

/** Whole days left until `date`, rounded up and never less than 1. */
export const daysUntil = (date: Date, now: Date): number =>
  Math.max(1, Math.ceil((date.getTime() - now.getTime()) / DAY_MS))

/** "1 file", "42 files"; `many` for an irregular plural ("companies"). */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "Ana" from "Ana Pérez Soler". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}
