// In-app question before a song is swapped for another one. Used when the
// current song is safely kept in "My songs in this browser".

export function confirmStart(message: string, startLabel: string, start: () => void): void {
  const overlay = document.createElement('div')
  overlay.className = 'help-overlay'
  const card = document.createElement('div')
  card.className = 'help-card replace-card'
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  card.setAttribute('aria-label', message)
  const text = document.createElement('p')
  text.textContent = message
  const dismiss = (): void => { overlay.remove(); document.removeEventListener('keydown', onKey) }
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') dismiss() }
  document.addEventListener('keydown', onKey)
  card.appendChild(text)
  for (const [label, action] of [
    [startLabel, start],
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
  overlay.addEventListener('click', e => { if (e.target === overlay) dismiss() })
  overlay.appendChild(card)
  document.body.appendChild(overlay)
  card.querySelector('button')?.focus()
}
