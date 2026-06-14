// Phone gate for the apps (studio + synth). Tablets and larger are allowed —
// only true phones get the "use a bigger screen" message. We gate on a coarse
// pointer AND a small physical screen (min side < 600 CSS px): every iPhone /
// Android phone fails it; every iPad / tablet / desktop passes. Using
// screen.* (not window.inner*) means a small desktop browser window is never
// mistaken for a phone.

export function isPhone(): boolean {
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const minSide = Math.min(window.screen.width, window.screen.height)
    return coarse && minSide < 600
  } catch {
    return false
  }
}

interface BlockLink {
  href: string
  label: string
}

export function renderMobileBlock(name: string, links: BlockLink[]): void {
  const root = document.getElementById('app')
  if (root) root.innerHTML = ''
  const el = document.createElement('div')
  el.className = 'mobile-block'
  const linkHtml = links
    .map(l => `<a href="${l.href}">${l.label}</a>`)
    .join('')
  el.innerHTML = `
    <div class="mb-card">
      <h1>${name}</h1>
      <p class="mb-lead">${name} isn't available on phones.</p>
      <p class="mb-sub">It needs more room than a phone screen. Open it on a
        <strong>desktop, laptop, or tablet</strong> for the full experience.</p>
      <div class="mb-links">${linkHtml}</div>
    </div>`
  document.body.appendChild(el)
}
