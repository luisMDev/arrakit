import { describe, expect, it } from 'vitest'

import {
  clockRange,
  clockTime,
  count,
  countWord,
  daysBetween,
  firstName,
  firstOfNextMonth,
  initial,
  dateTile,
  dayWithWeekday,
  fullDay,
  listing,
  meetingWhen,
  monthOf,
  shortDay,
} from './copy'

describe('calendar days', () => {
  it('writes a YYYY-MM-DD day as that day, wherever the server runs', () => {
    expect(dayWithWeekday('2026-10-09')).toBe('Fri, Oct 9')
    expect(dayWithWeekday('2026-01-01')).toBe('Thu, Jan 1')
    expect(shortDay('2027-10-04')).toBe('Oct 4')
    expect(fullDay('2027-10-04')).toBe('Oct 4, 2027')
    expect(monthOf('2026-11-01')).toBe('November')
  })

  it('refuses something that is not a calendar day', () => {
    expect(() => shortDay('2026-10-09T10:00:00Z')).toThrow(/YYYY-MM-DD/)
    expect(() => shortDay('INV-2026-0042')).toThrow(/YYYY-MM-DD/)
  })
})

describe('clock times', () => {
  it.each([
    ['10:00', '10:00 AM'],
    ['16:30', '4:30 PM'],
    ['12:00', '12:00 PM'],
    ['00:30', '12:30 AM'],
  ])('writes %s as %s', (time, written) => {
    expect(clockTime(time)).toBe(written)
  })

  it('writes a call as a range, the period once when both ends share it', () => {
    expect(clockRange('10:00', 60)).toBe('10:00 to 11:00 AM')
    expect(clockRange('11:30', 60)).toBe('11:30 AM to 12:30 PM')
    expect(clockRange('16:00', 45)).toBe('4:00 to 4:45 PM')
    expect(clockRange('23:30', 60)).toBe('11:30 PM to 12:30 AM')
  })
})

describe('meetingWhen', () => {
  it('writes an instant as its day and clock time in the time zone given', () => {
    expect(meetingWhen(new Date('2026-10-09T08:00:00Z'), 'Europe/Madrid')).toBe(
      'Fri, Oct 9 · 10:00 AM',
    )

    expect(meetingWhen(new Date('2026-10-09T23:30:00Z'), 'Europe/Madrid')).toBe(
      'Sat, Oct 10 · 1:30 AM',
    )
    expect(meetingWhen(new Date('2026-10-09T23:30:00Z'), 'America/Santiago')).toBe(
      'Fri, Oct 9 · 8:30 PM',
    )
  })
})

describe('counts', () => {
  it('says one thing in the singular and any other number in the plural', () => {
    expect(count(1, 'file')).toBe('1 file')
    expect(count(42, 'file')).toBe('42 files')
    expect(count(0, 'file')).toBe('0 files')
    expect(count(1, 'company', 'companies')).toBe('1 company')
    expect(count(3, 'company', 'companies')).toBe('3 companies')
  })

  it('spells small numbers as words and writes larger ones as numerals', () => {
    expect(countWord(1)).toBe('One')
    expect(countWord(2)).toBe('Two')
    expect(countWord(10)).toBe('Ten')
    expect(countWord(12)).toBe('12')
  })

  it('joins a list the way a sentence does', () => {
    expect(listing([])).toBe('')
    expect(listing(['the memo'])).toBe('the memo')
    expect(listing(['the memo', '11 public sources'])).toBe('the memo and 11 public sources')
    expect(listing(['a', 'b', 'c'])).toBe('a, b and c')
  })
})

describe('dateTile', () => {
  it('is the short weekday in capitals over the day of the month', () => {
    expect(dateTile('2026-10-09')).toEqual(['FRI', '9'])
  })
})

describe('in Spanish', () => {
  it('writes days day first, in lower case', () => {
    expect(dayWithWeekday('2026-10-09', 'es')).toBe('vie, 9 oct')
    expect(shortDay('2027-10-04', 'es')).toBe('4 oct')
    expect(fullDay('2027-10-04', 'es')).toBe('4 oct 2027')
    expect(monthOf('2026-11-01', 'es')).toBe('noviembre')
    expect(dateTile('2026-10-09', 'es')).toEqual(['VIE', '9'])
  })

  it('writes clock times on a 24-hour clock', () => {
    expect(clockTime('16:30', 'es')).toBe('16:30')
    expect(clockTime('09:05', 'es')).toBe('9:05')
    expect(clockRange('23:30', 60, 'es')).toBe('23:30 a 0:30')
    expect(meetingWhen(new Date('2026-10-09T08:00:00Z'), 'Europe/Madrid', 'es')).toBe(
      'vie, 9 oct · 10:00',
    )
  })

  it('writes counts and lists', () => {
    expect(countWord(2, 'es')).toBe('Dos')
    expect(listing(['a', 'b', 'c'], 'es')).toBe('a, b y c')
  })
})

describe('day arithmetic', () => {
  it('finds the first of the next month and the days between two days', () => {
    expect(firstOfNextMonth('2026-10-09')).toBe('2026-11-01')
    expect(firstOfNextMonth('2026-12-31')).toBe('2027-01-01')
    expect(daysBetween('2026-10-07', '2026-10-09')).toBe(2)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
  })

  it('names first names and initials', () => {
    expect(firstName('  Ana Pérez Soler ')).toBe('Ana')
    expect(initial(' lucia@x.com')).toBe('L')
  })
})
