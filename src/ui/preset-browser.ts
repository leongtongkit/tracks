import { buildPresetPatch, PRESETS } from '../patch/presets'
import type { Store } from '../state/store'

// Header preset browser: prev/next + a name chip that opens a grouped list.
export class PresetBrowser {
  readonly el: HTMLElement
  private index = -1
  private readonly store: Store
  private readonly nameBtn: HTMLButtonElement
  private readonly list: HTMLDivElement

  constructor(store: Store) {
    this.store = store
    this.el = document.createElement('div')
    this.el.className = 'preset-browser'

    const prev = chipButton('<', 'Previous preset')
    prev.addEventListener('click', () => this.load(this.index <= 0 ? PRESETS.length - 1 : this.index - 1))
    const next = chipButton('>', 'Next preset')
    next.addEventListener('click', () => this.load((this.index + 1) % PRESETS.length))

    this.nameBtn = document.createElement('button')
    this.nameBtn.type = 'button'
    this.nameBtn.className = 'preset-name'
    this.nameBtn.textContent = 'Select a preset'
    this.nameBtn.setAttribute('aria-haspopup', 'listbox')
    this.nameBtn.addEventListener('click', () => this.toggleList())

    this.list = document.createElement('div')
    this.list.className = 'preset-list hidden'
    this.buildList()

    this.el.appendChild(prev)
    this.el.appendChild(this.nameBtn)
    this.el.appendChild(next)
    this.el.appendChild(this.list)

    document.addEventListener('pointerdown', e => {
      if (!this.el.contains(e.target as Node)) this.list.classList.add('hidden')
    })
  }

  load(index: number): void {
    const def = PRESETS[index]
    if (!def) return
    this.index = index
    this.store.loadPatch(buildPresetPatch(def))
    this.nameBtn.innerHTML = `<em>${def.category}</em> ${def.name}`
    this.list.classList.add('hidden')
    for (const btn of this.list.querySelectorAll('.preset-item')) {
      btn.classList.toggle('preset-item-on', Number((btn as HTMLElement).dataset.index) === index)
    }
  }

  private toggleList(): void {
    this.list.classList.toggle('hidden')
  }

  private buildList(): void {
    let lastCategory = ''
    PRESETS.forEach((def, i) => {
      if (def.category !== lastCategory) {
        lastCategory = def.category
        const head = document.createElement('div')
        head.className = 'preset-cat'
        head.textContent = def.category
        this.list.appendChild(head)
      }
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'preset-item'
      item.dataset.index = String(i)
      item.textContent = def.name
      item.addEventListener('click', () => this.load(i))
      this.list.appendChild(item)
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
