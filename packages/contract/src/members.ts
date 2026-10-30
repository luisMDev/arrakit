import { z } from 'zod'

import { assignableRoleSchema, base, roleSchema } from './common'

export const memberSchema = z.object({ name: z.string(), email: z.string(), role: roleSchema })

export const membersContract = {
  list: base
    .route({ method: 'GET', path: '/members', tags: ['members'] })
    .output(z.array(memberSchema)),
  changeRole: base
    .route({ method: 'PATCH', path: '/members/{email}', tags: ['members'] })
    .input(z.object({ email: z.string(), role: assignableRoleSchema }))
    .output(memberSchema),
  remove: base
    .route({ method: 'DELETE', path: '/members/{email}', tags: ['members'] })
    .input(z.object({ email: z.string() }))
    .output(z.void()),
}
