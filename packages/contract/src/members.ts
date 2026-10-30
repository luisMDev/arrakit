import { z } from 'zod'

import { assignableRoleSchema, base, roleSchema } from './common'

export const memberSchema = z.object({ name: z.string(), email: z.string(), role: roleSchema })
export type Member = z.infer<typeof memberSchema>

export const membersContract = {
  list: base.output(z.array(memberSchema)),
  changeRole: base
    .input(z.object({ email: z.string(), role: assignableRoleSchema }))
    .output(memberSchema),
  remove: base.input(z.object({ email: z.string() })).output(z.void()),
}
