import { canceledEmail } from './templates/canceled'
import { downgradedEmail } from './templates/downgraded'
import { failedEmail } from './templates/failed'
import { memberEmail } from './templates/member'
import { receiptEmail } from './templates/receipt'
import { renewEmail } from './templates/renew'
import { signinEmail } from './templates/signin'

export const EMAIL_TEMPLATES = {
  signin: signinEmail,
  member: memberEmail,
  receipt: receiptEmail,
  renew: renewEmail,
  failed: failedEmail,
  canceled: canceledEmail,
  downgraded: downgradedEmail,
} as const

export type EmailTemplateName = keyof typeof EMAIL_TEMPLATES
