import { describe, expect, it } from 'vitest'
import { deviceName } from './device-name'

describe('deviceName', () => {
  it.each([
    [
      'Safari on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      'Mac',
    ],
    [
      'Chrome on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Mac',
    ],
    [
      'Safari on an iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'iPhone',
    ],
    [
      'Chrome on an iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
      'iPhone',
    ],
    [
      'Safari on an iPad',
      'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      'iPad',
    ],
    [
      'Chrome on Android',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
      'Android phone',
    ],
    [
      'Chrome on Windows 10',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Windows PC',
    ],
    [
      'Edge on Windows 10',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68',
      'Windows PC',
    ],
    [
      'Firefox on Ubuntu',
      'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
      'Linux computer',
    ],
  ])('names %s', (_label, userAgent, name) => {
    expect(deviceName(userAgent)).toBe(name)
  })

  it.each([
    ['no user agent', null],
    ['an empty one', ''],
    ['supertest', 'node-superagent/3.8.3'],
    ['curl', 'curl/8.4.0'],
    ['a crawler with Mac in its name', 'Macintosh-Bot/1.0 (+http://example.com/crawler)'],
    [
      'a Chromebook',
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    ],
    ['Windows Update', 'Windows-Update-Agent/10.0.10011.16384 Client-Protocol/2.0'],
    ['iPhone only in a query string', 'SomeFetcher/2.1 (+https://example.com/?ref=iphone-app)'],
  ])('reads %s as a browser, guessing nothing', (_label, userAgent) => {
    expect(deviceName(userAgent)).toBe('browser')
  })
  it('reads an iPad in desktop mode as a Mac', () => {
    expect(
      deviceName(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      ),
    ).toBe('Mac')
  })
})
