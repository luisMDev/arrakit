import { ACCOUNT_LANGUAGES, isAccountLanguage, isTimeZone } from '@arrakit/address'

/** A Standard Schema that accepts what `accepts` does, refusing the rest with `message`. */
function rule(accepts: (value: unknown) => boolean, message: string) {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'arrakit',
      validate: (value: unknown) => (accepts(value) ? { value } : { issues: [{ message }] }),
    },
  }
}

/** The person's own settings, written through `update-user`, which refreshes the session cookie. */
export const userFields = {
  language: {
    type: [...ACCOUNT_LANGUAGES],
    defaultValue: 'en' as const,
    validator: { input: rule(isAccountLanguage, 'Pick a language from the list.') },
  },
  timeZone: {
    type: 'string' as const,
    required: false as const,
    validator: {
      input: rule(
        (value) => typeof value === 'string' && isTimeZone(value),
        'Pick a time zone from the list.',
      ),
    },
  },
  emailProductNews: {
    type: 'boolean' as const,
    defaultValue: false,
    validator: {
      input: rule((value) => typeof value === 'boolean', 'Choose whether to get product news.'),
    },
  },
}
