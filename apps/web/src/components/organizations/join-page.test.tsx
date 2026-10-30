import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sendMagicLink } from '#/components/auth/auth-api'
import { answerAuth, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { JoinPage } from './join-page'

vi.mock('#/components/auth/auth-api', async (original) => ({
  ...(await original<typeof import('#/components/auth/auth-api')>()),
  sendMagicLink: vi.fn(),
}))

const sendLink = vi.mocked(sendMagicLink)

setupTestApi()
beforeEach(() => {
  sendLink.mockReset().mockResolvedValue(true)
  quiet()
})

const setup = () => renderAt(<JoinPage invitationId="inv/1" />, { me: null, url: '/join/inv-1' })

async function askForLink(email = 'jon@birch.vc') {
  await userEvent.type(await screen.findByLabelText('Your work email'), email)
  await userEvent.click(screen.getByRole('button', { name: 'Send me a new link' }))
}

describe('JoinPage', () => {
  it('joins once, makes the organization active and opens the app', async () => {
    const ORG_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
    const calls = answerAuth('organization/accept-invitation', async () => {
      await new Promise((r) => setTimeout(r, 50))
      return { invitation: { id: 'inv/1' }, member: { id: 'm-1', organizationId: ORG_ID } }
    })
    const activated = answerAuth('organization/set-active', { id: ORG_ID })
    const { location } = setup()
    expect(await screen.findByRole('status')).toHaveTextContent('Joining your organization…')
    await waitFor(() => expect(location()).toBe('/app'))
    expect(calls).toEqual([{ input: { invitationId: 'inv/1' } }])
    expect(activated).toEqual([{ input: { organizationId: ORG_ID } }])
  })

  it('says a person already in the organization so, and opens the app', async () => {
    answerAuth('organization/accept-invitation', [409, "You're already in Birch."])
    setup()
    expect(await screen.findByText("You're already in this organization.")).toBeInTheDocument()
    expect(screen.getByText("You're already in Birch.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/app')
  })

  it.each([
    [400, 'INVITATION_NOT_FOUND'],
    [403, 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION'],
  ])('says the invite is closed on %s %s', async (status, code) => {
    answerAuth('organization/accept-invitation', [status, 'refused', code])
    setup()
    expect(await screen.findByText('This invite is not open.')).toBeInTheDocument()
  })

  it('explains a full organization in our words', async () => {
    answerAuth('organization/accept-invitation', [
      403,
      'Organization membership limit reached',
      'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED',
    ])
    setup()
    expect(await screen.findByText("Couldn't join right now.")).toBeInTheDocument()
    expect(screen.getByText(/The organization has no free seat/)).toBeInTheDocument()
  })

  it('reports an unexpected failure', async () => {
    answerAuth('organization/accept-invitation', 500)
    setup()
    expect(await screen.findByText("Couldn't join right now.")).toBeInTheDocument()
    expect(console.error).toHaveBeenCalled()
  })

  it('asks a signed-out person for their email and sends a link back here', async () => {
    answerAuth('organization/accept-invitation', 401)
    setup()
    expect(await screen.findByText('Your link has')).toBeInTheDocument()
    await askForLink(' jon@birch.vc ')
    expect(await screen.findByText('Check your')).toBeInTheDocument()
    expect(sendLink).toHaveBeenCalledWith('jon@birch.vc', '/join/inv%2F1')
  })

  it('refuses an address that is not a work email without sending', async () => {
    answerAuth('organization/accept-invitation', 401)
    setup()
    await askForLink('jon@birch')
    expect(
      await screen.findByText('Enter your work email, like name@company.com.'),
    ).toBeInTheDocument()
    expect(sendLink).not.toHaveBeenCalled()
  })

  it('explains a refused address', async () => {
    answerAuth('organization/accept-invitation', 401)
    sendLink.mockResolvedValue(false)
    setup()
    await askForLink()
    expect(
      await screen.findByText('Enter your work email, like name@company.com.'),
    ).toBeInTheDocument()
  })

  it.each([
    [{ status: 429 }, 'Too many links asked for. Wait a minute and try again.'],
    [Object.assign(new Error('Sign in from the app.'), { status: 403 }), 'Sign in from the app.'],
    [new Error('network'), "Couldn't send the link. Try again."],
  ])('explains a link that did not go (%s)', async (error, message) => {
    answerAuth('organization/accept-invitation', 401)
    sendLink.mockRejectedValue(error)
    setup()
    await askForLink()
    expect(await screen.findByText(message)).toBeInTheDocument()
  })
})
