import { render, screen } from '@testing-library/react'
import { Inbox } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { EmptyState } from './empty-state'

describe('EmptyState', () => {
  it('shows the title, the hint and the action', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="Nothing yet"
        description="Things you add show up here."
        action={<button type="button">Add one</button>}
      />,
    )
    expect(screen.getByText('Nothing yet')).toBeInTheDocument()
    expect(screen.getByText('Things you add show up here.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add one' })).toBeInTheDocument()
  })

  it('renders only the title when nothing else is given', () => {
    const { container } = render(<EmptyState icon={Inbox} title="Nothing yet" />)
    expect(container.querySelector('[data-slot="empty-description"]')).toBeNull()
    expect(container.querySelector('[data-slot="empty-content"]')).toBeNull()
  })
})
