import type { FileView, UploadTicket } from '@arrakit/contract'
import { filePolicyFor } from '@arrakit/plans'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { answer, answerStorage, meAs, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { FileBrowser } from './file-browser'

setupTestApi()

const WORKSPACE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const STORAGE_URL = 'https://storage.test/bucket/upload'

let ids = 0
const fileOf = (name: string, overrides: Partial<FileView> = {}): FileView => ({
  id: `0f8fad5b-d9cb-469f-a165-${String((ids += 1)).padStart(12, '0')}`,
  workspaceId: null,
  name,
  contentType: 'application/pdf',
  sizeBytes: 1_500_000,
  uploadedById: 'someone',
  uploaderName: 'Ana Ruiz',
  uploadedByYou: false,
  uploadedOn: '2026-11-02',
  ...overrides,
})

const ticketFor = (file: FileView): UploadTicket => ({
  file,
  upload: {
    url: STORAGE_URL,
    headers: { 'content-type': file.contentType },
    expiresAt: '2026-11-03T10:00:00.000Z',
  },
})

const renderBrowser = (
  { role = 'owner', permissions }: { role?: string; permissions?: Record<string, string[]> } = {},
  workspaceId?: string,
) => {
  return renderAt(<FileBrowser workspaceId={workspaceId} />, {
    url: '/app/files',
    me: meAs({ role, ...(permissions ? { permissions } : {}) }),
  })
}

const row = (name: string) => document.querySelector<HTMLElement>(`[data-file="${name}"]`)!
const pick = (...files: File[]) =>
  userEvent.upload(screen.getByLabelText('Choose files', { selector: 'input' }), files)

describe('FileBrowser', () => {
  it('lists the files with their size, uploader and day', async () => {
    const listed = answer('files/list', [
      fileOf('Deck.pdf'),
      fileOf('Notes.md', { uploaderName: null }),
    ])
    renderBrowser({}, WORKSPACE_ID)

    await screen.findByRole('table', { name: 'Files' })
    expect(row('Deck.pdf')).toHaveTextContent('1.5 MB')
    expect(row('Deck.pdf')).toHaveTextContent('Ana Ruiz')
    expect(row('Deck.pdf')).toHaveTextContent('Nov 2, 2026')
    expect(row('Notes.md')).toHaveTextContent('Someone who left')
    expect(listed).toEqual([{ input: { workspaceId: WORKSPACE_ID } }])
  })

  it('says when there are none yet', async () => {
    answer('files/list', [])
    renderBrowser()
    expect(await screen.findByText('No files yet.')).toBeInTheDocument()
  })

  it('offers uploads only to a role that may upload', async () => {
    answer('files/list', [])
    renderBrowser({ role: 'viewer', permissions: { file: ['read'] } })
    await screen.findByText('No files yet.')
    expect(screen.queryByRole('button', { name: 'Choose files' })).toBeNull()
  })

  it('lets a member rename and delete their own files only', async () => {
    answer('files/list', [fileOf('Board.pdf'), fileOf('Mine.pdf', { uploadedByYou: true })])
    renderBrowser({ role: 'member' })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Actions for Board.pdf' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Download'])
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Actions for Mine.pdf' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Download',
      'Rename',
      'Delete',
    ])
  })

  it('uploads a file straight to storage, completes it and refreshes the list', async () => {
    const notes = fileOf('notes.md', { contentType: 'text/markdown', sizeBytes: 7 })
    const requested = answer('files/requestUpload', ticketFor(notes))
    const stored = answerStorage(STORAGE_URL)
    const completed = answer('files/completeUpload', notes)
    answer('files/list', [], [notes])
    renderBrowser({}, WORKSPACE_ID)
    await screen.findByText('No files yet.')

    await pick(new File(['# Notes'], 'notes.md', { type: 'text/markdown' }))

    expect(await screen.findByText('notes.md uploaded.')).toBeInTheDocument()
    expect(requested).toEqual([
      { input: { workspaceId: WORKSPACE_ID, name: 'notes.md', sizeBytes: 7 } },
    ])
    expect(stored).toEqual([{ contentType: 'text/markdown', bytes: 7 }])
    expect(completed).toEqual([{ input: { id: notes.id } }])
    expect(await screen.findByRole('table', { name: 'Files' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Uploads' })).toBeNull()
  })

  it('refuses a type or a size the plan does not allow before calling the API', async () => {
    const requested = answer('files/requestUpload', 500)
    answer('files/list', [])
    renderBrowser()
    await screen.findByText('No files yet.')

    const big = new File(['%PDF'], 'big.pdf')
    Object.defineProperty(big, 'size', { value: filePolicyFor('team').maxBytes + 1 })
    await pick(new File(['MZ'], 'tool.exe'), big)

    const uploads = await screen.findByRole('list', { name: 'Uploads' })
    expect(within(uploads).getByText(/can't be uploaded. Allowed: pdf, doc/)).toBeInTheDocument()
    expect(
      within(uploads).getByText('This file is larger than the 50 MB limit.'),
    ).toBeInTheDocument()
    expect(requested).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss tool.exe' }))
    expect(screen.queryByText(/Allowed: pdf, doc/)).toBeNull()
  })

  it('says why the API refused an upload, beside the file', async () => {
    quiet()
    answer('files/requestUpload', [402, 'Storage limit reached'])
    answer('files/list', [])
    renderBrowser()
    await screen.findByText('No files yet.')

    await pick(new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' }))

    expect(
      await screen.findByText(
        'Your organization is out of storage. Add credits in Settings → Billing.',
      ),
    ).toBeInTheDocument()
  })

  it('says the upload failed when storage refuses the bytes', async () => {
    quiet()
    const deck = fileOf('deck.pdf')
    answer('files/requestUpload', ticketFor(deck))
    answerStorage(STORAGE_URL, 403)
    const completed = answer('files/completeUpload', deck)
    answer('files/list', [])
    renderBrowser()
    await screen.findByText('No files yet.')

    await pick(new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' }))

    expect(await screen.findByText("Couldn't upload the file. Try again.")).toBeInTheDocument()
    expect(completed).toEqual([])
  })

  it('renames a file, keeping its extension', async () => {
    const deck = fileOf('Deck.pdf')
    const renamed = answer('files/rename', { ...deck, name: 'Pitch.pdf' })
    answer('files/list', [deck], [{ ...deck, name: 'Pitch.pdf' }])
    renderBrowser()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Actions for Deck.pdf' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rename file' })
    const name = within(dialog).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Pitch.txt')
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }))
    expect(await within(dialog).findByText('Keep the .pdf extension.')).toBeInTheDocument()

    await user.clear(name)
    await user.type(name, 'Pitch.pdf')
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }))

    expect(await screen.findByText('Renamed to Pitch.pdf.')).toBeInTheDocument()
    expect(renamed).toEqual([{ input: { id: deck.id, name: 'Pitch.pdf' } }])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('deletes a file once confirmed', async () => {
    const deck = fileOf('Deck.pdf')
    const deleted = answer('files/delete', undefined)
    answer('files/list', [deck], [])
    renderBrowser()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Actions for Deck.pdf' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Deck.pdf?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Deck.pdf deleted.')).toBeInTheDocument()
    expect(deleted).toEqual([{ input: { id: deck.id } }])
    expect(await screen.findByText('No files yet.')).toBeInTheDocument()
  })

  it('asks for a download link', async () => {
    quiet()
    const deck = fileOf('Deck.pdf')
    const linked = answer('files/downloadUrl', {
      url: 'https://storage.test/bucket/download',
      expiresAt: '2026-11-03T10:00:00.000Z',
    })
    answer('files/list', [deck])
    renderBrowser()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Actions for Deck.pdf' }))
    await user.click(screen.getByRole('menuitem', { name: 'Download' }))

    await waitFor(() => expect(linked).toEqual([{ input: { id: deck.id } }]))
  })
})
