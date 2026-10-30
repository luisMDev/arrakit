/** The languages the copy writes. */
export type CopyLang = 'en' | 'es'

const MONTHS: Record<CopyLang, readonly string[]> = {
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  es: [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ],
}
const WEEKDAYS: Record<CopyLang, readonly string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
}

interface CalendarDay {
  year: number
  /** 0 for January. */
  month: number
  date: number
  /** 0 for Sunday. */
  weekday: number
}

function calendarDay(day: string): CalendarDay {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) throw new Error(`"${day}" is not a calendar day (YYYY-MM-DD)`)
  const [year, month, date] = match.slice(1).map(Number) as [number, number, number]
  // Only to learn the weekday: UTC in, UTC out, so no time zone can move it.
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay()
  return { year, month: month - 1, date, weekday }
}

/** Midnight UTC of a calendar day, for day arithmetic only. */
function utcOf(day: string): number {
  const { year, month, date } = calendarDay(day)
  return Date.UTC(year, month, date)
}

/** The first day of the month after `day`'s: "2026-10-09" → "2026-11-01". */
export function firstOfNextMonth(day: string): string {
  const { year, month } = calendarDay(day)
  return new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10)
}

/** Whole days from one calendar day to a later one: "2026-10-07" → "2026-10-09" is 2. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / 86_400_000)
}

const short = (name: string | undefined): string => (name ?? '').slice(0, 3)

/** "Fri, Oct 9"; "vie, 9 oct" */
export function dayWithWeekday(day: string, lang: CopyLang = 'en'): string {
  const d = calendarDay(day)
  return `${short(WEEKDAYS[lang][d.weekday])}, ${shortDay(day, lang)}`
}

/** "Oct 4"; "4 oct" */
export function shortDay(day: string, lang: CopyLang = 'en'): string {
  const d = calendarDay(day)
  const month = short(MONTHS[lang][d.month])
  return lang === 'es' ? `${d.date} ${month}` : `${month} ${d.date}`
}

/** "Oct 4, 2027"; "4 oct 2027" */
export function fullDay(day: string, lang: CopyLang = 'en'): string {
  const year = calendarDay(day).year
  return lang === 'es' ? `${shortDay(day, lang)} ${year}` : `${shortDay(day, lang)}, ${year}`
}

/** "November"; "noviembre" */
export function monthOf(day: string, lang: CopyLang = 'en'): string {
  return MONTHS[lang][calendarDay(day).month] ?? ''
}

/** "FRI" and "9", the date tile of a calendar event; "VIE" and "9". */
export function dateTile(day: string, lang: CopyLang = 'en'): [weekday: string, date: string] {
  const d = calendarDay(day)
  return [short(WEEKDAYS[lang][d.weekday]).toUpperCase(), String(d.date)]
}

function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function clock(minutesOfDay: number): { time: string; period: 'AM' | 'PM' } {
  const total = ((minutesOfDay % 1440) + 1440) % 1440
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return {
    time: `${hours % 12 || 12}:${String(minutes).padStart(2, '0')}`,
    period: hours < 12 ? 'AM' : 'PM',
  }
}

/** A 24-hour clock time as Spanish writes it: "09:05" → "9:05". */
function clock24(minutesOfDay: number): string {
  const total = ((minutesOfDay % 1440) + 1440) % 1440
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** "10:00" → "10:00 AM", "00:30" → "12:30 AM"; in Spanish "16:30" stays "16:30". */
export function clockTime(time: string, lang: CopyLang = 'en'): string {
  if (lang === 'es') return clock24(minutesOf(time))
  const { time: written, period } = clock(minutesOf(time))
  return `${written} ${period}`
}

/** One formatter per zone: building an `Intl.DateTimeFormat` costs far more than using it. */
const zoneFormats = new Map<string, Intl.DateTimeFormat>()
function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  let format = zoneFormats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    zoneFormats.set(timeZone, format)
  }
  return format
}

/**
 * An instant as a person in `timeZone` (IANA) reads it: "Fri, Oct 9 · 10:00 AM".
 * The zone gives the calendar day and the clock time; the words are the ones
 * `dayWithWeekday` and `clockTime` write.
 */
export function meetingWhen(start: Date, timeZone: string, lang: CopyLang = 'en'): string {
  const parts = zoneFormat(timeZone).formatToParts(start)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''
  const day = `${part('year')}-${part('month')}-${part('day')}`
  return `${dayWithWeekday(day, lang)} · ${clockTime(`${part('hour')}:${part('minute')}`, lang)}`
}

/** A call from its start and length: "10:00 to 11:00 AM", "11:30 AM to 12:30 PM"; "10:00 a 11:00". */
export function clockRange(start: string, minutes: number, lang: CopyLang = 'en'): string {
  if (lang === 'es') return `${clock24(minutesOf(start))} a ${clock24(minutesOf(start) + minutes)}`
  const from = clock(minutesOf(start))
  const to = clock(minutesOf(start) + minutes)
  const first = from.period === to.period ? from.time : `${from.time} ${from.period}`
  return `${first} to ${to.time} ${to.period}`
}

/** "1 file", "42 files"; `many` for an irregular plural ("companies"). */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

const WORDS: Record<CopyLang, readonly string[]> = {
  en: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'],
  es: ['Una', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve', 'Diez'],
}

/** "Two" for a headline; a numeral past ten. */
export function countWord(n: number, lang: CopyLang = 'en'): string {
  return WORDS[lang][n - 1] ?? String(n)
}

/** The capital an avatar or a logo shows: a name's, or an email's. */
export function initial(nameOrEmail: string): string {
  return nameOrEmail.trim().charAt(0).toUpperCase()
}

/** "Ana" from "Ana Pérez Soler". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** "a", "a and b", "a, b and c"; "a, b y c" */
export function listing(items: readonly string[], lang: CopyLang = 'en'): string {
  if (items.length < 2) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${lang === 'es' ? 'y' : 'and'} ${items[items.length - 1]}`
}
