let host: HTMLElement | null = null

export function toast(message: string): void {
  if (!host) {
    host = document.createElement('div')
    host.className = 'toast-host'
    document.body.appendChild(host)
  }
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = message
  host.appendChild(el)
  requestAnimationFrame(() => el.classList.add('toast-in'))
  setTimeout(() => {
    el.classList.remove('toast-in')
    setTimeout(() => el.remove(), 300)
  }, 2200)
}
