export function showFirstVisitTip(): void {
  try {
    if (localStorage.getItem('tracks.tip.v1')) return
  } catch { /* Storage may be unavailable. */ }
  const tip = document.createElement('aside')
  tip.className = 'first-visit-tip'
  tip.setAttribute('aria-label', 'Start a beat')
  const title = document.createElement('strong')
  title.textContent = 'Start a beat'
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'seg-btn'
  close.textContent = 'Close'
  const dismiss = (): void => {
    tip.remove()
    document.removeEventListener('keydown', onKey)
    try { localStorage.setItem('tracks.tip.v1', 'dismissed') } catch { /* Storage may be unavailable. */ }
  }
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') dismiss() }
  close.addEventListener('click', dismiss)
  document.addEventListener('keydown', onKey)
  const steps = document.createElement('ol')
  for (const text of [
    'Click + Drums to add a drum track.',
    'Double-click an empty spot in its lane to create a clip, then double-click the clip to edit it.',
    'Click the Kick and Snare rows in the grid to add notes.',
    'Press Space to play or stop.',
  ]) {
    const item = document.createElement('li')
    item.textContent = text
    steps.appendChild(item)
  }
  const link = document.createElement('a')
  link.href = '/help/'
  link.target = '_blank'
  link.rel = 'noopener'
  link.textContent = 'Full tutorial'
  tip.append(title, close, steps, link)
  document.body.appendChild(tip)
}
