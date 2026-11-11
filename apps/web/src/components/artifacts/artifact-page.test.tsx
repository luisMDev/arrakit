import type { Artifact, ArtifactContent, ArtifactVersion } from '@arrakit/contract'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { answer, meAs, renderAt, setupTestApi } from '#/test/rpc'

import { ArtifactPage } from './artifact-page'
import { ARTIFACT_CSP } from './sandboxed-document'

setupTestApi()

const WORKSPACE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const ARTIFACT_ID = '3b241101-e2bb-4255-8caf-4136c566a962'

const artifactOf = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: ARTIFACT_ID,
  workspaceId: WORKSPACE_ID,
  title: 'Pipeline review',
  format: 'html',
  currentVersion: 2,
  createdById: 'someone',
  creatorName: 'Ana Ruiz',
  createdByYou: false,
  createdOn: '2026-11-02',
  updatedAt: '2026-11-03T09:05:00.000Z',
  ...overrides,
})

const VERSIONS: ArtifactVersion[] = [2, 1].map((number) => ({
  number,
  sizeBytes: 12,
  publishedById: 'someone',
  publisherName: 'Ana Ruiz',
  publishedAt: `2026-11-0${number + 1}T09:05:00.000Z`,
}))

const contentOf = (input: unknown, artifact = artifactOf()): ArtifactContent => {
  const version = (input as { version?: number }).version ?? artifact.currentVersion
  return {
    artifactId: artifact.id,
    version,
    format: artifact.format,
    content: artifact.format === 'html' ? `<h1>Version ${version}</h1>` : `# Version ${version}`,
  }
}

const open = (artifact = artifactOf(), me = meAs()) => {
  answer('artifacts/get', artifact)
  answer('artifacts/versions', VERSIONS)
  const contents = answer('artifacts/content', (input: unknown) => contentOf(input, artifact))
  const view = renderAt(<ArtifactPage workspaceId={WORKSPACE_ID} artifactId={artifact.id} />, {
    url: `/app/workspaces/${WORKSPACE_ID}/artifacts/${artifact.id}`,
    me,
  })
  return { ...view, contents }
}

const frame = () => screen.findByTitle<HTMLIFrameElement>('Pipeline review')

describe('ArtifactPage', () => {
  it('runs an HTML version in a sandboxed frame that never shares the app origin', async () => {
    open()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Pipeline review' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/^By Ana Ruiz · updated/)).toBeInTheDocument()
    const iframe = await frame()
    const sandbox = iframe.getAttribute('sandbox')!.split(' ')
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-same-origin')
    expect(iframe.getAttribute('srcdoc')).toContain(ARTIFACT_CSP)
    expect(iframe.getAttribute('srcdoc')).toContain('<h1>Version 2</h1>')
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('shows a Markdown version as a document, not in a frame', async () => {
    open(artifactOf({ format: 'markdown' }))
    expect(await screen.findByText('# Version 2')).toBeInTheDocument()
    expect(screen.queryByTitle('Pipeline review')).toBeNull()
  })

  it('opens an earlier version', async () => {
    const { contents } = open()
    await frame()
    const user = userEvent.setup()

    await user.click(screen.getByRole('combobox', { name: 'Version' }))
    await user.click(await screen.findByRole('option', { name: /^Version 1 ·/ }))
    await waitFor(async () =>
      expect((await frame()).getAttribute('srcdoc')).toContain('<h1>Version 1</h1>'),
    )
    expect(contents.map((call) => call.input)).toEqual([
      { id: ARTIFACT_ID, version: 2 },
      { id: ARTIFACT_ID, version: 1 },
    ])
  })

  it('publishes a new version for the creator', async () => {
    const published = answer('artifacts/publish', artifactOf({ currentVersion: 3 }))
    open(artifactOf({ createdByYou: true }), meAs({ role: 'member' }))
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'New version' }))
    const dialog = await screen.findByRole('dialog', { name: 'New version of Pipeline review' })
    expect(within(dialog).getByText(/This becomes version 3/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('textbox', { name: 'Title' })).toBeNull()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Content' }), {
      target: { value: '<h1>Version 3</h1>' },
    })
    await user.click(within(dialog).getByRole('button', { name: 'Publish version' }))

    expect(await screen.findByText('Version 3 of Pipeline review published.')).toBeInTheDocument()
    expect(published).toEqual([{ input: { id: ARTIFACT_ID, content: '<h1>Version 3</h1>' } }])
  })

  it('refuses a file of another format for a new version', async () => {
    open(artifactOf({ createdByYou: true }))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New version' }))
    const dialog = await screen.findByRole('dialog', { name: 'New version of Pipeline review' })
    await user.upload(
      within(dialog).getByLabelText('Load from file', { selector: 'input' }),
      new File(['# notes'], 'notes.md', { type: 'text/markdown' }),
    )
    expect(
      await within(dialog).findByText("Choose a file in this artifact's format."),
    ).toBeInTheDocument()
  })

  it('deletes the artifact and goes back to the list', async () => {
    const deleted = answer('artifacts/delete', {})
    const { location } = open()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Pipeline review?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(location()).toBe(`/app/workspaces/${WORKSPACE_ID}/artifacts`))
    expect(deleted).toEqual([{ input: { id: ARTIFACT_ID } }])
  })

  it('lets a role that only reads download the source, without changing it', async () => {
    open(artifactOf(), meAs({ role: 'member' }))
    await frame()
    expect(screen.getByRole('button', { name: 'Download source' })).toBeEnabled()
    for (const name of ['New version', 'Rename', 'Delete']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('does not show an artifact of another workspace', async () => {
    open(artifactOf({ workspaceId: '0f8fad5b-d9cb-469f-a165-70867728950e' }))
    expect(await screen.findByText("This artifact isn't in this workspace.")).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })
})
