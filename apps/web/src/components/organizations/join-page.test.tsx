import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { sendMagicLink } from '#/components/auth/auth-api'
import { answer, api, quiet, renderAt } from '#/test/rpc'

import { JoinPage } from './join-page'

vi.mock('#/components/auth/auth-api', async (original) => ({
  ...(await original<typeof import('#/components/auth/auth-api')>()),
  sendMagicLink: vi.fn(),
}))

const sendLink = vi.mocked(sendMagicLink)

beforeAll(() => api.listen({ onUnhandledFrame: 'bypass' }))
beforeEach(() => {
  sendLink.mockReset().mockResolvedValue(true)
  quiet()
})
afterEach(() => {
  api.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => api.close())

const setup = () => renderAt(<JoinPage invitationId="inv/1" />, { me: null, url: '/join/inv-1' })

async function askForLink(email = 'jon@birch.vc') {
  await userEvent.type(await screen.findByLabelText('Your work email'), email)
  await userEvent.click(screen.getByRole('button', { name: 'Send me a new link' }))
}

describe('JoinPage', () => {
  it('joins and opens the app', async () => {
    const calls = answer('invitations/accept', async () => {
      await new Promise((r) => setTimeout(r, 50))
      return {
        organization: {
          id: '0f8fad5b-d9cb-469f-a165-70867728950e',
          name: 'Birch',
          slug: 'birch',
          plan: 'team',
        },
        role: 'member',
      }
    })
    const { location } = setup()
    expect(await screen.findByRole('status')).toHaveTextContent('Joining your organization…')
    await waitFor(() => expect(location()).toBe('/app'))
    expect(calls).toEqual([{ input: { id: 'inv/1' } }])
  })

  it('says a person who has an organization already, with Sign in', async () => {
    answer('invitations/accept', 409)
    setup()
    expect(await screen.findByText('You already belong to an organization.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin')
  })

  it('says the invite is closed on 404', async () => {
    answer('invitations/accept', 404)
    setup()
    expect(await screen.findByText('This invite is not open.')).toBeInTheDocument()
  })

  it('reports an unexpected failure', async () => {
    answer('invitations/accept', 500)
    setup()
    expect(await screen.findByText("Couldn't join right now.")).toBeInTheDocument()
    expect(console.error).toHaveBeenCalled()
  })

  it('asks a signed-out person for their email and sends a link back here', async () => {
    answer('invitations/accept', 401)
    setup()
    expect(await screen.findByText('Your link has')).toBeInTheDocument()
    await askForLink(' jon@birch.vc ')
    expect(await screen.findByText('Check your')).toBeInTheDocument()
    expect(sendLink).toHaveBeenCalledWith('jon@birch.vc', '/join/inv%2F1')
  })

  it('refuses an address that is not a work email without sending', async () => {
    answer('invitations/accept', 401)
    setup()
    await askForLink('jon@birch')
    expect(
      await screen.findByText('Enter your work email, like name@company.com.'),
    ).toBeInTheDocument()
    expect(sendLink).not.toHaveBeenCalled()
  })

  it('explains a refused address', async () => {
    answer('invitations/accept', 401)
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
    answer('invitations/accept', 401)
    sendLink.mockRejectedValue(error)
    setup()
    await askForLink()
    expect(await screen.findByText(message)).toBeInTheDocument()
  })
})
