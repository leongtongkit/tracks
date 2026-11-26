export function confirmReplace(save: () => void, replace: () => void): void {
  const overlay = document.createElement('div')
  overlay.className = 'help-overlay'
  const card = document.createElement('div')
  card.className = 'help-card replace-card'
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  card.setAttribute('aria-label', 'Replace the current song?')
  const message = document.createElement('p')
  message.textContent = 'Replace the current song? Unsaved changes are lost. Save first to keep it.'
  const dismiss = (): void => { overlay.remove(); document.removeEventListener('keydown', onKey) }
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') dismiss() }
  document.addEventListener('keydown', onKey)
  card.appendChild(message)
  for (const [label, action] of [
    ['Save first', () => { save(); replace() }],
    ['Replace', replace],
    ['Cancel', () => {}],
  ] as const) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'seg-btn'
    button.textContent = label
    button.addEventListener('click', () => { dismiss(); action() })
    card.appendChild(button)
  }
  card.addEventListener('keydown', e => {
    if (e.key === 'Escape') dismiss()
    e.stopPropagation()
  })
  overlay.appendChild(card)
  document.body.appendChild(overlay)
  card.querySelector('button')?.focus()
}
