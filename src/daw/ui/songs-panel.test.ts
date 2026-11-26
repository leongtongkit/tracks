import { describe, expect, it } from 'vitest'
import { songRowTitle } from './songs-panel'

// A rename reaches the library entry only on the next debounced autosave, so
// right after renaming the kept entry still carries the old name. The list row
// must show the live project name for the open song, not the stale entry.
describe('songs list row title', () => {
  it('shows the live name of the open song right after a rename', () => {
    expect(songRowTitle('Old name', true, 'New name')).toBe('New name')
  })

  it('falls back to Untitled for an open song whose name was cleared', () => {
    expect(songRowTitle('Old name', true, '   ')).toBe('Untitled')
  })

  it('shows the kept name for songs that are not open', () => {
    expect(songRowTitle('House sketch', false, 'New name')).toBe('House sketch')
  })
})
