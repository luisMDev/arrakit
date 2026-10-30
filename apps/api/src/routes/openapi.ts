import { contract } from '@arrakit/contract'
import {
  type AnyContractRouter,
  ContractProcedure,
  type ErrorMap,
  isContractProcedure,
} from '@orpc/contract'
import { OpenAPIGenerator } from '@orpc/openapi'
import { type AnyRouter, Procedure, isProcedure } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'

/** The error statuses an operation can answer, by HTTP status (docs/spec/platform.md section 4). */
const ERRORS = {
  400: { code: 'BAD_REQUEST', message: 'The input is not valid' },
  401: { code: 'UNAUTHORIZED', message: 'No live session' },
  402: { code: 'PAYMENT_REQUIRED', message: 'Payment required' },
  403: { code: 'FORBIDDEN', message: 'Not allowed for this role, or from another site' },
  404: { code: 'NOT_FOUND', message: 'No organization, or no such item in it' },
  409: { code: 'CONFLICT', message: 'Not possible in the current state' },
  502: { code: 'BAD_GATEWAY', message: 'Stripe refused or did not answer' },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'A service is not set up or did not answer' },
} as const

type ErrorStatus = keyof typeof ERRORS

export interface OperationStatuses {
  /** The success status, when not the contract's own (void deletes answer 204, no body). */
  success?: 204
  errors: ErrorStatus[]
}

const ADMIN = [401, 403, 404] as const satisfies ErrorStatus[]
const STRIPE = [502, 503] as const satisfies ErrorStatus[]

/**
 * What each procedure answers besides its success, keyed by contract path. Every procedure with
 * an input can answer 400 (validation). Kept next to the REST surface: a router that starts
 * throwing another status adds it here (a test fails for a procedure missing from the table).
 */
export const OPERATION_STATUSES: Record<string, OperationStatuses> = {
  'health.get': { errors: [] },
  'authProviders.get': { errors: [] },
  'me.get': { errors: [401] },
  'me.delete': { success: 204, errors: [401, 409] },
  'me.account.get': { errors: [401] },
  'me.account.update': { errors: [400, 401] },
  'organizations.create': { errors: [400, 401, 409] },
  'organizations.skip': { errors: [401, 409] },
  'organizations.update': { errors: [400, ...ADMIN] },
  'organizations.delete': { success: 204, errors: [...ADMIN, ...STRIPE] },
  'members.list': { errors: [...ADMIN] },
  'members.changeRole': { errors: [400, ...ADMIN] },
  'members.remove': { success: 204, errors: [400, ...ADMIN] },
  'invitations.list': { errors: [...ADMIN] },
  'invitations.invite': { errors: [400, ...ADMIN] },
  'invitations.resend': { errors: [400, ...ADMIN, 503] },
  'invitations.cancel': { success: 204, errors: [400, ...ADMIN] },
  'invitations.accept': { errors: [400, 401, 403, 404, 409] },
  'plans.list': { errors: [] },
  'billing.checkout': { errors: [400, ...ADMIN, 409, ...STRIPE] },
  'billing.get': { errors: [...ADMIN, ...STRIPE] },
  'billing.previewChange': { errors: [400, ...ADMIN, 409, ...STRIPE] },
  'billing.change': { errors: [400, ...ADMIN, 402, 409, ...STRIPE] },
  'billing.cancel': { errors: [...ADMIN, 409, ...STRIPE] },
  'billing.resume': { errors: [...ADMIN, 409, ...STRIPE] },
  'billing.portal': { errors: [400, ...ADMIN, 409, ...STRIPE] },
  'billing.topUp': { errors: [400, ...ADMIN, ...STRIPE] },
  'usage.get': { errors: [401, 404] },
}

function statusesOf(path: string[]): OperationStatuses {
  const statuses = OPERATION_STATUSES[path.join('.')]
  if (!statuses) throw new Error(`[api] no documented statuses for procedure ${path.join('.')}`)
  return statuses
}

function mapLeaves<T>(
  node: unknown,
  isLeaf: (value: unknown) => boolean,
  leaf: (value: never, path: string[]) => unknown,
  path: string[] = [],
): T {
  if (isLeaf(node)) return leaf(node as never, path) as T
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).map(([key, child]) => [
      key,
      mapLeaves(child, isLeaf, leaf, [...path, key]),
    ]),
  ) as T
}

function errorMapOf(statuses: OperationStatuses): ErrorMap {
  return Object.fromEntries(
    statuses.errors.map((status) => [ERRORS[status].code, { status, ...ERRORS[status] }]),
  )
}

/**
 * The contract as the OpenAPI document describes it: each procedure's error map is exactly the
 * statuses it answers, and void deletes answer 204.
 */
export function documentedContract(router: AnyContractRouter = contract): AnyContractRouter {
  return mapLeaves(
    router,
    isContractProcedure,
    (procedure: ContractProcedure<never, never, never, never>, path) => {
      const def = procedure['~orpc']
      const statuses = statusesOf(path)
      return new ContractProcedure({
        ...def,
        errorMap: errorMapOf(statuses),
        route: { ...def.route, ...(statuses.success && { successStatus: statuses.success }) },
      })
    },
  )
}

/** The router served REST-style, with the success statuses the document gives (204 deletes). */
export function restRouter<T extends AnyRouter>(router: T): T {
  return mapLeaves(
    router,
    isProcedure,
    (procedure: Procedure<never, never, never, never, never, never>, path) => {
      const success = statusesOf(path).success
      if (!success) return procedure
      const def = procedure['~orpc']
      return new Procedure({ ...def, route: { ...def.route, successStatus: success } })
    },
  )
}

type Document = Awaited<ReturnType<OpenAPIGenerator['generate']>>

/** The OpenAPI document generated from the contract alone (no DB, no env). */
export async function generateOpenApiDocument(): Promise<Document> {
  const document = await new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  }).generate(documentedContract(), {
    info: { title: 'Arrakit API', version: '1.0.0' },
    servers: [{ url: '/api' }],
  })
  for (const item of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(item ?? {})) {
      const noContent = (operation as { responses?: Record<string, { content?: unknown }> })
        ?.responses?.['204']
      if (noContent) delete noContent.content
    }
  }
  return document
}
