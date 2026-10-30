import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Index } from './index'

describe('Index placeholder', () => {
  it('renders the product name and a sign-in link', () => {
    render(<Index />)
    expect(screen.getByRole('heading', { name: 'Arrakit' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin')
  })
})
