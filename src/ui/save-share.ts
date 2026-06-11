import { patchToHash } from '../patch/serialize'
import { saveUserPatch } from '../patch/storage'
import type { Store } from '../state/store'
import type { PresetBrowser } from './preset-browser'
import { toast } from './toast'

// Save (name + store locally) and Share (patch-in-URL copy) controls.
export function buildSaveShare(store: Store, browser: PresetBrowser): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'save-share'

  const saveBtn = button('Save', 'Save current sound to this browser')
  const shareBtn = button('Share', 'Copy a link that opens this exact sound')

  const form = document.createElement('form')
  form.className = 'save-form hidden'
  const input = document.createElement('input')
  input.type = 'text'
  input.maxLength = 24
  input.placeholder = 'Name your sound'
  input.className = 'save-input'
  const confirm = button('OK', 'Confirm save')
  confirm.type = 'submit'
  form.appendChild(input)
  form.appendChild(confirm)

  saveBtn.addEventListener('click', () => {
    form.classList.toggle('hidden')
    if (!form.classList.contains('hidden')) {
      const current = store.getPatch().name
      input.value = current === 'Init' ? '' : current
      input.focus()
    }
  })

  form.addEventListener('submit', e => {
    e.preventDefault()
    const name = input.value.trim()
    if (!name) return
    const patch = structuredClone(store.getPatch())
    patch.name = name
    patch.category = 'user'
    saveUserPatch(patch)
    browser.refresh()
    store.set('name', name)
    store.set('category', 'user')
    form.classList.add('hidden')
    toast(`Saved "${name}"`)
  })

  shareBtn.addEventListener('click', () => {
    void (async () => {
      const hash = await patchToHash(store.getPatch())
      const url = `${location.origin}${location.pathname}${hash}`
      history.replaceState(null, '', hash)
      try {
        await navigator.clipboard.writeText(url)
        toast('Link copied. Anyone who opens it hears this exact sound.')
      } catch {
        toast('Link is in the address bar. Copy it to share.')
      }
    })()
  })

  wrap.appendChild(saveBtn)
  wrap.appendChild(shareBtn)
  wrap.appendChild(form)
  return wrap
}

function button(text: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'seg-btn'
  btn.textContent = text
  btn.setAttribute('aria-label', label)
  return btn
}
