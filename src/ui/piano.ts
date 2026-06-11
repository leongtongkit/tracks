// On-screen keyboard as TWO stacked manuals mirroring the computer keyboard:
// upper row = Q-row + number row (one octave up), lower row = Z-row + S-row.
// Every key shows its computer-key hint in keyboard order. Pointer/multitouch
// with glissando; external highlight API lights the same keys for key presses.

const WHITE_SEMIS = [0, 2, 4, 5, 7, 9, 11]

interface ManualSpec {
  name: string
  startSemi: number // inclusive, relative to base C
  endSemi: number // inclusive
  hints: string[]
}

const MANUALS: ManualSpec[] = [
  {
    name: 'upper',
    startSemi: 12,
    endSemi: 31,
    hints: ['Q', '2', 'W', '3', 'E', 'R', '5', 'T', '6', 'Y', '7', 'U', 'I', '9', 'O', '0', 'P', '[', '=', ']'],
  },
  {
    name: 'lower',
    startSemi: 0,
    endSemi: 16,
    hints: ['Z', 'S', 'X', 'D', 'C', 'V', 'G', 'B', 'H', 'N', 'J', 'M', ',', 'L', '.', ';', '/'],
  },
]

export interface PianoHandlers {
  noteOn(note: number): void
  noteOff(note: number): void
}

export class Piano {
  readonly el: HTMLElement
  private baseOctave = 4
  private readonly keys = new Map<number, HTMLElement[]>() // semi -> key els (may exist on both manuals)
  private readonly pointers = new Map<number, number>() // pointerId -> sounding note
  private readonly handlers: PianoHandlers

  constructor(handlers: PianoHandlers) {
    this.handlers = handlers
    this.el = document.createElement('div')
    this.el.className = 'piano-shell piano-2up'

    const maxWhites = Math.max(...MANUALS.map(m => countWhites(m)))
    for (const spec of MANUALS) {
      this.el.appendChild(this.buildManual(spec, maxWhites))
    }
    this.bindPointers(this.el)
  }

  private buildManual(spec: ManualSpec, maxWhites: number): HTMLElement {
    const row = document.createElement('div')
    row.className = `piano manual-${spec.name}`
    const whiteCount = countWhites(spec)
    row.style.width = `${(whiteCount / maxWhites) * 100}%`
    const whiteW = 100 / whiteCount

    let whiteIndex = 0
    for (let semi = spec.startSemi, k = 0; semi <= spec.endSemi; semi++, k++) {
      const isWhite = WHITE_SEMIS.includes(((semi % 12) + 12) % 12)
      const key = document.createElement('div')
      key.dataset.semi = String(semi)
      if (isWhite) {
        key.className = 'key-w'
        whiteIndex++
      } else {
        key.className = 'key-b'
        key.style.left = `${whiteIndex * whiteW - whiteW * 0.3}%`
        key.style.width = `${whiteW * 0.6}%`
      }
      const hint = spec.hints[k]
      if (hint) {
        const span = document.createElement('span')
        span.className = 'key-hint'
        span.textContent = hint
        key.appendChild(span)
      }
      row.appendChild(key)
      const list = this.keys.get(semi) ?? []
      list.push(key)
      this.keys.set(semi, list)
    }
    return row
  }

  setOctave(_octave: number): void {
    this.baseOctave = _octave
    this.clearHighlights()
  }

  highlight(note: number, on: boolean): void {
    const semi = note - (this.baseOctave + 1) * 12
    for (const key of this.keys.get(semi) ?? []) key.classList.toggle('key-down', on)
  }

  clearHighlights(): void {
    for (const list of this.keys.values()) {
      for (const key of list) key.classList.remove('key-down')
    }
  }

  private noteAt(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const target = el?.closest<HTMLElement>('[data-semi]')
    if (!target) return null
    return (this.baseOctave + 1) * 12 + Number(target.dataset.semi)
  }

  private bindPointers(shell: HTMLElement): void {
    shell.addEventListener('pointerdown', e => {
      const note = this.noteAt(e.clientX, e.clientY)
      if (note === null) return
      e.preventDefault()
      try {
        shell.setPointerCapture(e.pointerId)
      } catch {
        // synthetic events have no active pointer; glissando still works
      }
      this.pointers.set(e.pointerId, note)
      this.handlers.noteOn(note)
      this.highlight(note, true)
    })
    shell.addEventListener('pointermove', e => {
      const current = this.pointers.get(e.pointerId)
      if (current === undefined) return
      const note = this.noteAt(e.clientX, e.clientY)
      if (note === null || note === current) return
      this.handlers.noteOff(current)
      this.highlight(current, false)
      this.pointers.set(e.pointerId, note)
      this.handlers.noteOn(note)
      this.highlight(note, true)
    })
    const end = (e: PointerEvent): void => {
      const note = this.pointers.get(e.pointerId)
      if (note === undefined) return
      this.pointers.delete(e.pointerId)
      this.handlers.noteOff(note)
      this.highlight(note, false)
    }
    shell.addEventListener('pointerup', end)
    shell.addEventListener('pointercancel', end)
  }
}

function countWhites(spec: ManualSpec): number {
  let n = 0
  for (let s = spec.startSemi; s <= spec.endSemi; s++) {
    if (WHITE_SEMIS.includes(((s % 12) + 12) % 12)) n++
  }
  return n
}
