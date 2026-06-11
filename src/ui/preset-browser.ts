import { buildPresetPatch, PRESETS } from '../patch/presets'
import type { Patch } from '../patch/schema'
import { deleteUserPatch, loadUserPatches } from '../patch/storage'
import type { Store } from '../state/store'
import { toast } from './toast'

interface Entry {
  label: string
  category: string
  userId?: string // present for user-saved patches
  build(): Patch
}

// Header preset browser: prev/next + a name chip opening a grouped list.
// Lists factory presets followed by user-saved patches.
export class PresetBrowser {
  readonly el: HTMLElement
  private index = -1
  private entries: Entry[] = []
  private readonly store: Store
  private readonly nameBtn: HTMLButtonElement
  private readonly list: HTMLDivElement

  constructor(store: Store) {
    this.store = store
    this.el = document.createElement('div')
    this.el.className = 'preset-browser'

    const prev = chipButton('<', 'Previous preset')
    prev.addEventListener('click', () =>
      this.load(this.index <= 0 ? this.entries.length - 1 : this.index - 1),
    )
    const next = chipButton('>', 'Next preset')
    next.addEventListener('click', () => this.load((this.index + 1) % this.entries.length))

    this.nameBtn = document.createElement('button')
    this.nameBtn.type = 'button'
    this.nameBtn.className = 'preset-name'
    this.nameBtn.textContent = 'Select a preset'
    this.nameBtn.setAttribute('aria-haspopup', 'listbox')
    this.nameBtn.addEventListener('click', () => this.list.classList.toggle('hidden'))

    this.list = document.createElement('div')
    this.list.className = 'preset-list hidden'

    this.el.appendChild(prev)
    this.el.appendChild(this.nameBtn)
    this.el.appendChild(next)
    this.el.appendChild(this.list)

    this.refresh()

    document.addEventListener('pointerdown', e => {
      if (!this.el.contains(e.target as Node)) this.list.classList.add('hidden')
    })
  }

  // Rebuild entries from factory presets + localStorage; call after saves.
  refresh(): void {
    this.entries = PRESETS.map(def => ({
      label: def.name,
      category: def.category,
      build: () => buildPresetPatch(def),
    }))
    for (const saved of loadUserPatches()) {
      this.entries.push({
        label: saved.patch.name,
        category: 'user',
        userId: saved.id,
        build: () => saved.patch,
      })
    }
    this.buildList()
  }

  load(index: number): void {
    const entry = this.entries[index]
    if (!entry) return
    this.index = index
    this.store.loadPatch(entry.build())
    this.showName(entry)
    this.list.classList.add('hidden')
    for (const btn of this.list.querySelectorAll('.preset-item')) {
      btn.classList.toggle('preset-item-on', Number((btn as HTMLElement).dataset.index) === index)
    }
  }

  // Reflect an externally-loaded patch (share link, session restore).
  showLoaded(patch: Patch): void {
    this.index = this.entries.findIndex(e => e.label === patch.name && e.category === patch.category)
    this.showName({ label: patch.name, category: patch.category } as Entry)
  }

  private showName(entry: Pick<Entry, 'label' | 'category'>): void {
    this.nameBtn.innerHTML = ''
    const cat = document.createElement('em')
    cat.textContent = entry.category
    this.nameBtn.appendChild(cat)
    this.nameBtn.appendChild(document.createTextNode(entry.label))
  }

  private buildList(): void {
    this.list.innerHTML = ''
    let lastCategory = ''
    this.entries.forEach((entry, i) => {
      if (entry.category !== lastCategory) {
        lastCategory = entry.category
        const head = document.createElement('div')
        head.className = 'preset-cat'
        head.textContent = entry.category
        this.list.appendChild(head)
      }
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'preset-item'
      item.dataset.index = String(i)
      item.textContent = entry.label
      item.addEventListener('click', () => this.load(i))
      this.list.appendChild(item)

      if (entry.userId) {
        const del = document.createElement('button')
        del.type = 'button'
        del.className = 'preset-del'
        del.textContent = 'x'
        del.setAttribute('aria-label', `Delete ${entry.label}`)
        del.addEventListener('click', e => {
          e.stopPropagation()
          deleteUserPatch(entry.userId!)
          toast(`Deleted "${entry.label}"`)
          this.refresh()
        })
        item.appendChild(del)
      }
    })
  }
}

function chipButton(text: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'seg-btn'
  btn.textContent = text
  btn.setAttribute('aria-label', label)
  return btn
}
