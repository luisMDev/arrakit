import { randomUUID } from 'node:crypto'

import { type SQL, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type Database, transaction } from './connection'
import { isInsufficientPrivilege } from './errors'
import { taskTopics } from './tasks/signals'
import {
  type Claims,
  type TestData,
  memberClaims,
  openTestData,
  rawSql,
  realtimeJoinSees,
  scopedTo,
  systemClaims,
} from './testing'

async function rowsOf<T = Record<string, unknown>>(db: Database, query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows
}

/** What a refused statement threw, or `undefined` when it went through. */
async function failureOf(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work()
    return undefined
  } catch (err) {
    return err
  }
}

const broadcast = (topic: string, payload: object = { taskId: randomUUID() }) =>
  sql`select app.broadcast(${topic}, 'task.changed', ${JSON.stringify(payload)}::jsonb)`

describe('Realtime in the database', () => {
  let data: TestData
  const raw = () => rawSql(data)
  const messagesOn = async (topic: string) =>
    (
      await raw()(
        'select topic, extension, payload, event, private from realtime.messages where topic = $1',
        [topic],
      )
    ).rows

  const orgA = randomUUID()
  const orgB = randomUUID()
  const reader = randomUUID()
  const requester = randomUUID()

  beforeAll(async () => {
    data = await openTestData()
    await scopedTo(data.db, systemClaims(orgA))((tx) => tx.execute(broadcast(`org:${orgA}:seed`)))
    await scopedTo(data.db, systemClaims(orgB))((tx) => tx.execute(broadcast(`org:${orgB}:seed`)))
  })
  afterAll(() => data.close())

  describe('catalog', () => {
    it('lets only authenticated execute app.broadcast', async () => {
      const { rows } = await raw()(
        `select r as role, has_function_privilege(r, 'app.broadcast(text, text, jsonb)', 'execute') as allowed
         from unnest(array['anon', 'authenticated', 'service_role']) as r order by r`,
      )
      expect(rows).toEqual([
        { role: 'anon', allowed: false },
        { role: 'authenticated', allowed: true },
        { role: 'service_role', allowed: false },
      ])
      const { rows: toPublic } = await raw()(
        `select count(*)::int as n from pg_proc p, aclexplode(p.proacl) a
         where p.oid = 'app.broadcast(text, text, jsonb)'::regprocedure and a.grantee = 0`,
      )
      expect(toPublic).toEqual([{ n: 0 }])
    })

    it('has one policy on realtime.messages, for select, to authenticated', async () => {
      const { rows } = await raw()(
        `select cmd, roles::text as roles from pg_policies
         where schemaname = 'realtime' and tablename = 'messages'`,
      )
      expect(rows).toEqual([{ cmd: 'SELECT', roles: '{authenticated}' }])
    })
  })

  describe('app.broadcast', () => {
    it('writes a private broadcast for a member and for the system, in their organization', async () => {
      const organizationTopic = taskTopics.organization(orgA)
      const requesterTopic = taskTopics.requester(orgA, requester)
      const payload = { taskId: randomUUID() }

      await scopedTo(
        data.db,
        memberClaims(orgA, requester),
      )((tx) => tx.execute(broadcast(requesterTopic, payload)))
      await scopedTo(
        data.db,
        systemClaims(orgA),
      )((tx) => tx.execute(broadcast(organizationTopic, payload)))

      for (const topic of [requesterTopic, organizationTopic]) {
        expect(await messagesOn(topic)).toEqual([
          {
            topic,
            extension: 'broadcast',
            payload: { ...payload, id: expect.any(String) },
            event: 'task.changed',
            private: true,
          },
        ])
      }
    })

    it('refuses a topic of another organization and a session without claims', async () => {
      const topic = taskTopics.organization(orgB)
      const outside = await failureOf(() =>
        scopedTo(
          data.db,
          memberClaims(orgA, reader, ['task:read']),
        )((tx) => tx.execute(broadcast(topic))),
      )
      expect(isInsufficientPrivilege(outside)).toBe(true)
      expect(
        isInsufficientPrivilege(await failureOf(() => data.db.execute(broadcast(topic)))),
      ).toBe(true)
      const unclaimed = await failureOf(() =>
        transaction(data.db, async (tx) => {
          await tx.execute(sql`select set_config('role', 'authenticated', true)`)
          await tx.execute(broadcast(topic))
        }),
      )
      expect(isInsufficientPrivilege(unclaimed)).toBe(true)
      expect(await messagesOn(topic)).toEqual([])
    })

    it('is the only way in: a direct send writes nothing and a direct insert is refused', async () => {
      const topic = `org:${orgA}:direct`
      await scopedTo(
        data.db,
        memberClaims(orgA, reader),
      )((tx) => tx.execute(sql`select realtime.send('{}'::jsonb, 'task.changed', ${topic}, true)`))
      const inserted = await failureOf(() =>
        scopedTo(
          data.db,
          memberClaims(orgA, reader),
        )((tx) =>
          tx.execute(
            sql`insert into realtime.messages (topic, extension, event, private) values (${topic}, 'broadcast', 'task.changed', true)`,
          ),
        ),
      )
      expect(isInsufficientPrivilege(inserted)).toBe(true)
      expect(await messagesOn(topic)).toEqual([])
    })

    it('leaves nothing when its transaction rolls back', async () => {
      const topic = `org:${orgA}:rolled-back`
      await expect(
        scopedTo(
          data.db,
          systemClaims(orgA),
        )(async (tx) => {
          await tx.execute(broadcast(topic))
          throw new Error('rolled back')
        }),
      ).rejects.toThrow('rolled back')
      expect(await messagesOn(topic)).toEqual([])
    })
  })

  describe('who may join a topic', () => {
    const visibleTo = (claims: Claims, topic: string) => realtimeJoinSees(data, claims, topic)

    const visibleAs = (role: string, claims: object, topic: string) =>
      transaction(data.db, async (tx) => {
        await tx.execute(
          sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true), set_config('role', ${role}, true), set_config('realtime.topic', ${topic}, true)`,
        )
        const [row] = await rowsOf<{ n: number }>(
          tx,
          sql`select count(*)::int as n from realtime.messages`,
        )
        return row!.n
      })

    it('lets a member with task:read join the organization topic, and no one else', async () => {
      const topic = taskTopics.organization(orgA)
      expect(await visibleTo(memberClaims(orgA, reader, ['task:read']), topic)).toBeGreaterThan(0)
      expect(await visibleTo(memberClaims(orgA, reader), topic)).toBe(0)
      expect(await visibleTo(memberClaims(orgB, reader, ['task:read']), topic)).toBe(0)
    })

    it('lets the requester join their own topic, and no other member', async () => {
      const topic = taskTopics.requester(orgA, requester)
      expect(await visibleTo(memberClaims(orgA, requester), topic)).toBeGreaterThan(0)
      expect(await visibleTo(memberClaims(orgA, reader, ['task:read']), topic)).toBe(0)
      expect(await visibleTo(memberClaims(orgB, requester, ['task:read']), topic)).toBe(0)
    })

    it('shows nothing to claims without an organization or to anon', async () => {
      const topic = taskTopics.requester(orgA, requester)
      const noOrg = { sub: requester, role: 'authenticated', permissions: ['task:read'] }
      expect(await visibleAs('authenticated', noOrg, topic)).toBe(0)
      expect(await visibleAs('authenticated', noOrg, taskTopics.organization(orgA))).toBe(0)
      expect(await visibleAs('anon', memberClaims(orgA, requester), topic)).toBe(0)
    })
  })
})
