/** Columns of the organization tables Better Auth reads and returns besides its own (server and client). */
export const organizationSchema = {
  organization: {
    additionalFields: {
      plan: { type: 'string', input: false, required: true, defaultValue: 'free' },
    },
  },
  member: {
    additionalFields: {
      termsAcceptedAt: { type: 'date', input: false, required: false },
    },
  },
  invitation: {
    additionalFields: {
      emailSent: { type: 'boolean', input: false, required: true, defaultValue: false },
    },
  },
} as const
