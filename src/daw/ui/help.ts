// Shortcut cheat-sheet: press ? to toggle, Escape or click to close.

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / stop'],
  ['Enter', 'Back to start'],
  ['Letter rows', 'Play the armed track (two-manual keyboard)'],
  ['Arrow up / down', 'Octave up / down'],
  ['Tab / Left Shift', 'Pitch bend up / down'],
  ['Cmd Z / Shift Cmd Z', 'Undo / redo'],
  ['Cmd C / V', 'Copy / paste clip (paste lands at the playhead)'],
  ['Cmd D', 'Duplicate clip'],
  ['Cmd E', 'Split clip at the playhead'],
  ['Delete', 'Delete selected clip (or selected notes in the roll)'],
  ['Shift drag (piano roll)', 'Select multiple notes'],
  ['Shift click (note)', 'Add / remove a note from the selection'],
  ['Double-click (lane)', 'New clip'],
  ['Double-click (dial)', 'Reset to default'],
  ['Drag ruler', 'Set the loop region'],
  ['?', 'Toggle this sheet'],
]

export function buildHelpOverlay(): { toggle(): void } {
  const overlay = document.createElement('div')
  overlay.className = 'help-overlay hidden'
  const card = document.createElement('div')
  card.className = 'help-card'
  const title = document.createElement('h2')
  title.textContent = 'Keyboard shortcuts'
  card.appendChild(title)
  const table = document.createElement('dl')
  table.className = 'help-list'
  for (const [keys, what] of SHORTCUTS) {
    const dt = document.createElement('dt')
    dt.textContent = keys
    const dd = document.createElement('dd')
    dd.textContent = what
    table.appendChild(dt)
    table.appendChild(dd)
  }
  card.appendChild(table)
  overlay.appendChild(card)
  overlay.addEventListener('click', () => overlay.classList.add('hidden'))
  document.body.appendChild(overlay)
  return {
    toggle: () => overlay.classList.toggle('hidden'),
  }
}
