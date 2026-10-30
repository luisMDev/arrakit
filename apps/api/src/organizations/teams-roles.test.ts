import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type TestApp, createTestApp } from '../testing/app'
import { joined, orgApi, ownerOf } from '../testing/people'

describe('teams and custom roles (Better Auth organization plugin)', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  describe('teams', () => {
    it('creates, renames, fills, empties and removes a team; no default team is made', async () => {
      const owner = await ownerOf(t, 'owner@alder.vc')
      const ana = await joined(t, owner, 'ana@alder.vc')
      const api = orgApi(t, owner.headers)
      const organizationId = owner.organizationId
      expect((await api.get<unknown[]>('list-teams', { organizationId })).body).toEqual([])

      const created = await api.post<{ id: string }>('create-team', { name: 'Ops', organizationId })
      expect(created.status).toBe(200)
      const teamId = created.body.id
      expect(
        (await api.post('update-team', { teamId, data: { name: 'Operations' } })).body,
      ).toMatchObject({ name: 'Operations' })

      expect((await api.post('add-team-member', { teamId, userId: ana.userId })).status).toBe(200)
      const listed = await t.client(owner.headers).teams.members({ teamId })
      expect(listed.map((m) => m.email)).toEqual(['ana@alder.vc'])
      expect((await api.post('remove-team-member', { teamId, userId: ana.userId })).status).toBe(
        200,
      )

      expect((await api.post('remove-team', { teamId, organizationId })).status).toBe(200)
      expect((await api.get<unknown[]>('list-teams', { organizationId })).body).toEqual([])
    })

    it('lets a member read teams but not create or change them', async () => {
      const owner = await ownerOf(t, 'owner@birch.vc')
      const member = await joined(t, owner, 'marta@birch.vc')
      const organizationId = owner.organizationId
      const team = await orgApi(t, owner.headers).post<{ id: string }>('create-team', {
        name: 'Ops',
        organizationId,
      })
      const api = orgApi(t, member.headers)
      expect((await api.get<unknown[]>('list-teams', { organizationId })).body).toHaveLength(1)
      expect((await api.post('create-team', { name: 'Mine', organizationId })).status).toBe(403)
      expect(
        (await api.post('add-team-member', { teamId: team.body.id, userId: member.userId })).status,
      ).toBe(403)
      await expect(
        t.client(member.headers).teams.members({ teamId: team.body.id }),
      ).resolves.toEqual([])
      const outsider = await ownerOf(t, 'owner@other-birch.vc')
      await orgApi(t, owner.headers).post('add-team-member', {
        teamId: team.body.id,
        userId: member.userId,
      })
      await expect(
        t.client(outsider.headers).teams.members({ teamId: team.body.id }),
      ).resolves.toEqual([])
    })
  })

  describe('custom roles', () => {
    const FINANCE = { billing: ['read'] }

    it('lets the owner create a role, give it, and the member then reads billing only', async () => {
      const owner = await ownerOf(t, 'owner@cedar.vc')
      const ana = await joined(t, owner, 'ana@cedar.vc')
      const api = orgApi(t, owner.headers)
      const organizationId = owner.organizationId
      expect(
        (await api.post('create-role', { role: 'Finance', permission: FINANCE, organizationId }))
          .status,
      ).toBe(200)
      expect(
        (
          await api.post('update-member-role', {
            memberId: ana.memberId,
            role: 'finance',
            organizationId,
          })
        ).status,
      ).toBe(200)

      const me = await t.client(ana.headers).me.get()
      expect(me).toMatchObject({ role: 'finance', permissions: { billing: ['read'] } })
      await expect(t.client(ana.headers).billing.get()).resolves.toMatchObject({ plan: 'team' })
      await expect(
        t.client(ana.headers).billing.portal({ to: 'payment-method' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(t.client(ana.headers).usage.get()).rejects.toMatchObject({ status: 403 })
    })

    it('invites straight into a custom role', async () => {
      const owner = await ownerOf(t, 'owner@elm.vc')
      const organizationId = owner.organizationId
      await orgApi(t, owner.headers).post('create-role', {
        role: 'finance',
        permission: FINANCE,
        organizationId,
      })
      await joined(t, owner, 'ana@elm.vc', 'finance')
      expect(
        (await t.data.forOrganization(organizationId).members.list()).map((m) => m.role),
      ).toEqual(['owner', 'finance'])
    })

    it('lets an admin manage roles within their own permissions only', async () => {
      const owner = await ownerOf(t, 'owner@fir.vc')
      const admin = await joined(t, owner, 'adm@fir.vc', 'admin')
      const marta = await joined(t, owner, 'marta@fir.vc')
      const organizationId = owner.organizationId
      const api = orgApi(t, admin.headers)
      expect(
        (await api.post('create-role', { role: 'finance', permission: FINANCE, organizationId }))
          .status,
      ).toBe(200)
      expect(
        (
          await api.post('create-role', {
            role: 'closer',
            permission: { organization: ['delete'] },
            organizationId,
          })
        ).status,
      ).toBe(403)
      expect(
        (
          await api.post('update-role', {
            roleName: 'finance',
            data: { permission: { billing: ['read'], organization: ['delete'] } },
            organizationId,
          })
        ).status,
      ).toBe(403)
      expect(
        (
          await api.post('update-role', {
            roleName: 'finance',
            data: { permission: { billing: ['read', 'manage'] } },
            organizationId,
          })
        ).status,
      ).toBe(200)
      expect((await api.post('delete-role', { roleName: 'finance', organizationId })).status).toBe(
        200,
      )
      expect(
        (
          await orgApi(t, marta.headers).post('create-role', {
            role: 'mine',
            permission: { usage: ['read'] },
            organizationId,
          })
        ).status,
      ).toBe(403)
    })

    it("refuses an admin who assigns a role with permissions they don't have", async () => {
      const owner = await ownerOf(t, 'owner@gum.vc')
      const admin = await joined(t, owner, 'adm@gum.vc', 'admin')
      const ana = await joined(t, owner, 'ana@gum.vc')
      const organizationId = owner.organizationId
      await orgApi(t, owner.headers).post('create-role', {
        role: 'closer',
        permission: { organization: ['delete'] },
        organizationId,
      })
      const api = orgApi(t, admin.headers)
      const NO = { status: 403, body: { message: "You can't give permissions you don't have." } }
      expect(
        await api.post('update-member-role', {
          memberId: ana.memberId,
          role: 'closer',
          organizationId,
        }),
      ).toMatchObject(NO)
      expect(
        await api.post('invite-member', { email: 'bo@gum.vc', role: 'closer', organizationId }),
      ).toMatchObject(NO)
      expect(
        (
          await orgApi(t, owner.headers).post('update-member-role', {
            memberId: ana.memberId,
            role: 'closer',
            organizationId,
          })
        ).status,
      ).toBe(200)
    })

    it("refuses an admin who changes or deletes a role with permissions they don't have", async () => {
      const owner = await ownerOf(t, 'owner@ivy.vc')
      const admin = await joined(t, owner, 'adm@ivy.vc', 'admin')
      const organizationId = owner.organizationId
      await orgApi(t, owner.headers).post('create-role', {
        role: 'closer',
        permission: { organization: ['delete'], billing: ['read'] },
        organizationId,
      })
      const api = orgApi(t, admin.headers)
      const NO = {
        status: 403,
        body: { message: "You can't change a role with permissions you don't have." },
      }
      expect(
        await api.post('update-role', {
          roleName: 'closer',
          data: { permission: { billing: ['read'] } },
          organizationId,
        }),
      ).toMatchObject(NO)
      expect(await api.post('delete-role', { roleName: 'Closer', organizationId })).toMatchObject(
        NO,
      )
      expect(
        (await orgApi(t, owner.headers).post('delete-role', { roleName: 'closer', organizationId }))
          .status,
      ).toBe(200)
    })

    it('refuses unknown resources, static names, and deleting a role still given', async () => {
      const owner = await ownerOf(t, 'owner@hazel.vc')
      const organizationId = owner.organizationId
      const api = orgApi(t, owner.headers)
      expect(
        (
          await api.post('create-role', {
            role: 'vault',
            permission: { vault: ['open'] },
            organizationId,
          })
        ).status,
      ).toBe(400)
      expect(
        (await api.post('create-role', { role: 'admin', permission: FINANCE, organizationId }))
          .status,
      ).toBe(400)
      await api.post('create-role', { role: 'finance', permission: FINANCE, organizationId })
      await joined(t, owner, 'ana@hazel.vc', 'finance')
      expect((await api.post('delete-role', { roleName: 'finance', organizationId })).status).toBe(
        400,
      )
    })
  })
})
