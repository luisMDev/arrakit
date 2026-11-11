import type { Artifact } from '@arrakit/contract'
import { artifactPolicyFor } from '@arrakit/plans'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { answer, meAs, renderAt, setupTestApi } from '#/test/rpc'

import { ArtifactList } from './artifact-list'

setupTestApi()

const WORKSPACE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

let ids = 0
const artifactOf = (title: string, overrides: Partial<Artifact> = {}): Artifact => ({
  id: `3b241101-e2bb-4255-8caf-${String((ids += 1)).padStart(12, '0')}`,
  workspaceId: WORKSPACE_ID,
  title,
  format: 'html',
  currentVersion: 1,
  createdById: 'someone',
  creatorName: 'Ana Ruiz',
  createdByYou: false,
  createdOn: '2026-11-02',
  updatedAt: '2026-11-03T09:05:00.000Z',
  ...overrides,
})

const renderList = ({
  role = 'owner',
  permissions,
}: { role?: string; permissions?: Record<string, string[]> } = {}) =>
  renderAt(<ArtifactList workspaceId={WORKSPACE_ID} />, {
    url: `/app/workspaces/${WORKSPACE_ID}/artifacts`,
    me: meAs({ role, ...(permissions ? { permissions } : {}), plan: 'free' }),
  })

const row = (title: string) => document.querySelector<HTMLElement>(`[data-artifact="${title}"]`)!

describe('ArtifactList', () => {
  it('lists the artifacts with their format, version and creator, linking each', async () => {
    const pipeline = artifactOf('Pipeline', { currentVersion: 3 })
    const listed = answer('artifacts/list', [
      pipeline,
      artifactOf('Notes', { format: 'markdown', creatorName: null }),
    ])
    renderList()

    await screen.findByRole('table', { name: 'Artifacts' })
    expect(row('Pipeline')).toHaveTextContent('HTML')
    expect(row('Pipeline')).toHaveTextContent('v3')
    expect(row('Pipeline')).toHaveTextContent('Ana Ruiz')
    expect(row('Notes')).toHaveTextContent('Markdown')
    expect(row('Notes')).toHaveTextContent('Someone who left')
    expect(within(row('Pipeline')).getByRole('link', { name: 'Pipeline' })).toHaveAttribute(
      'href',
      `/app/workspaces/${WORKSPACE_ID}/artifacts/${pipeline.id}`,
    )
    expect(listed).toEqual([{ input: { workspaceId: WORKSPACE_ID } }])
  })

  it('says when there are none yet', async () => {
    answer('artifacts/list', [])
    renderList()
    expect(await screen.findByText('No artifacts yet.')).toBeInTheDocument()
  })

  it('creates an artifact from pasted content', async () => {
    answer('artifacts/list', [])
    const created = answer('artifacts/create', (input: unknown) =>
      artifactOf((input as { title: string }).title),
    )
    renderList()
    await userEvent.click(await screen.findByRole('button', { name: 'New artifact' }))
    const dialog = await screen.findByRole('dialog', { name: 'New artifact' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Q3 review')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Content' }), {
      target: { value: '<h1>Q3</h1>' },
    })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create artifact' }))

    expect(await screen.findByText('Q3 review created.')).toBeInTheDocument()
    expect(created).toEqual([
      {
        input: {
          workspaceId: WORKSPACE_ID,
          title: 'Q3 review',
          format: 'html',
          content: '<h1>Q3</h1>',
        },
      },
    ])
  })

  it('reads the format, title and content from a Markdown file', async () => {
    answer('artifacts/list', [])
    const created = answer('artifacts/create', artifactOf('weekly-notes'))
    renderList()
    await userEvent.click(await screen.findByRole('button', { name: 'New artifact' }))
    const dialog = await screen.findByRole('dialog', { name: 'New artifact' })
    await userEvent.upload(
      within(dialog).getByLabelText('Load from file', { selector: 'input' }),
      new File(['# Week 45'], 'weekly-notes.md', { type: 'text/markdown' }),
    )
    await waitFor(() =>
      expect(within(dialog).getByRole('textbox', { name: 'Content' })).toHaveValue('# Week 45'),
    )
    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue('weekly-notes')
    expect(within(dialog).getByRole('combobox', { name: 'Format' })).toHaveTextContent('Markdown')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create artifact' }))

    await waitFor(() =>
      expect(created).toEqual([
        {
          input: {
            workspaceId: WORKSPACE_ID,
            title: 'weekly-notes',
            format: 'markdown',
            content: '# Week 45',
          },
        },
      ]),
    )
  })

  it('refuses a missing title, empty content and content over the plan limit before asking', async () => {
    answer('artifacts/list', [])
    const created = answer('artifacts/create', artifactOf('x'))
    renderList()
    await userEvent.click(await screen.findByRole('button', { name: 'New artifact' }))
    const dialog = await screen.findByRole('dialog', { name: 'New artifact' })
    const submit = within(dialog).getByRole('button', { name: 'Create artifact' })

    await userEvent.click(submit)
    expect(await within(dialog).findByText('Enter a title.')).toBeInTheDocument()
    expect(within(dialog).getByText('Add the content.')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Content' }), {
      target: { value: 'x'.repeat(artifactPolicyFor('free').maxBytes + 1) },
    })
    await userEvent.click(submit)
    expect(
      await within(dialog).findByText('The content is larger than the 2 MB limit.'),
    ).toBeInTheDocument()
    expect(created).toEqual([])
  })

  it('refuses a file that is not HTML or Markdown', async () => {
    answer('artifacts/list', [])
    renderList()
    await userEvent.click(await screen.findByRole('button', { name: 'New artifact' }))
    const dialog = await screen.findByRole('dialog', { name: 'New artifact' })
    await userEvent.upload(
      within(dialog).getByLabelText('Load from file', { selector: 'input' }),
      new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' }),
      { applyAccept: false },
    )
    expect(await within(dialog).findByText('Choose an .html or .md file.')).toBeInTheDocument()
  })

  it('lets a member change only their own artifacts, and hides New artifact without create', async () => {
    answer('artifacts/list', [artifactOf('Board pack'), artifactOf('Mine', { createdByYou: true })])
    renderList({ role: 'member' })
    await screen.findByRole('table', { name: 'Artifacts' })
    expect(screen.getByRole('button', { name: 'New artifact' })).toBeInTheDocument()
    expect(within(row('Board pack')).queryByRole('button', { name: /Actions/ })).toBeNull()
    expect(
      within(row('Mine')).getByRole('button', { name: 'Actions for Mine' }),
    ).toBeInTheDocument()
  })

  it('has no New artifact for a role that only reads them', async () => {
    answer('artifacts/list', [])
    renderList({ role: 'viewer', permissions: { workspace: ['read'], artifact: ['read'] } })
    await screen.findByText('No artifacts yet.')
    expect(screen.queryByRole('button', { name: 'New artifact' })).toBeNull()
  })

  it('renames and deletes an artifact', async () => {
    const pipeline = artifactOf('Pipeline')
    answer('artifacts/list', [pipeline])
    const renamed = answer('artifacts/rename', { ...pipeline, title: 'Pipeline Q3' })
    const deleted = answer('artifacts/delete', {})
    renderList()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Actions for Pipeline' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rename artifact' })
    const title = within(dialog).getByRole('textbox', { name: 'Title' })
    await user.clear(title)
    await user.type(title, 'Pipeline Q3')
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }))
    expect(await screen.findByText('Renamed to Pipeline Q3.')).toBeInTheDocument()
    expect(renamed).toEqual([{ input: { id: pipeline.id, title: 'Pipeline Q3' } }])

    await user.click(screen.getByRole('button', { name: 'Actions for Pipeline' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Pipeline?' })
    expect(within(confirm).getByText(/Every version goes with it/)).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Pipeline deleted.')).toBeInTheDocument()
    expect(deleted).toEqual([{ input: { id: pipeline.id } }])
  })
})
