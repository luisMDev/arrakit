import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  type AuthApi,
  AuthApiContext,
  AuthRequestError,
  EmailRefusedError,
} from '#/components/auth/auth-api'
import { answer, api, renderScreen } from '#/components/settings/testing'

import { JoinPage } from './join-page'

beforeAll(() => api.listen({ onUnhandledFrame: 'bypass' }))
afterEach(() => {
  api.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => api.close())

function setup(sendMagicLink: AuthApi['sendMagicLink'] = vi.fn().mockResolvedValue(undefined)) {
  const auth: AuthApi = {
    sendMagicLink,
    signInWith: vi.fn(),
    providers: vi.fn(),
  }
  const view = renderScreen(
    <AuthApiContext.Provider value={auth}>
      <JoinPage invitationId="inv/1" />
    </AuthApiContext.Provider>,
    { me: null as never, url: '/join/inv-1' },
  )
  return { ...view, auth }
}

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
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    answer('invitations/accept', 500)
    setup()
    expect(await screen.findByText("Couldn't join right now.")).toBeInTheDocument()
    expect(errors).toHaveBeenCalled()
  })

  it('asks a signed-out person for their email and sends a link back here', async () => {
    answer('invitations/accept', 401)
    const { auth } = setup()
    expect(await screen.findByText('Your link has')).toBeInTheDocument()
    await askForLink(' jon@birch.vc ')
    expect(await screen.findByText('Check your')).toBeInTheDocument()
    expect(auth.sendMagicLink).toHaveBeenCalledWith('jon@birch.vc', '/join/inv%2F1')
  })

  it('refuses an address that is not a work email without sending', async () => {
    answer('invitations/accept', 401)
    const { auth } = setup()
    await askForLink('jon@birch')
    expect(
      await screen.findByText('Enter your work email, like name@company.com.'),
    ).toBeInTheDocument()
    expect(auth.sendMagicLink).not.toHaveBeenCalled()
  })

  it.each([
    [new EmailRefusedError(), 'Enter your work email, like name@company.com.'],
    [new AuthRequestError(429), 'Too many links asked for. Wait a minute and try again.'],
    [Object.assign(new Error('Sign in from the app.'), { status: 403 }), 'Sign in from the app.'],
    [new Error('network'), "Couldn't send the link. Try again."],
  ])('explains a link that did not go (%s)', async (error, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    answer('invitations/accept', 401)
    setup(vi.fn().mockRejectedValue(error))
    await askForLink()
    expect(await screen.findByText(message)).toBeInTheDocument()
  })
})
