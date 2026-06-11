// On-screen piano: 2 octaves, pointer + multitouch with glissando, and an
// external highlight API so computer-keyboard presses light the same keys.

const SEMIS_IN_VIEW = 24
const WHITE_SEMIS = [0, 2, 4, 5, 7, 9, 11]
const KEY_HINTS: Record<number, string> = {
  0: 'A', 1: 'W', 2: 'S', 3: 'E', 4: 'D', 5: 'F', 6: 'T', 7: 'G', 8: 'Y',
  9: 'H', 10: 'U', 11: 'J', 12: 'K', 13: 'O', 14: 'L', 15: 'P', 16: ';', 17: "'",
}

export interface PianoHandlers {
  noteOn(note: number): void
  noteOff(note: number): void
}

export class Piano {
  readonly el: HTMLElement
  private baseOctave = 4
  private readonly keys = new Map<number, HTMLElement>() // semitone offset -> el
  private readonly pointers = new Map<number, number>() // pointerId -> sounding note
  private readonly handlers: PianoHandlers

  constructor(handlers: PianoHandlers) {
    this.handlers = handlers
    this.el = document.createElement('div')
    this.el.className = 'piano-shell'
    const piano = document.createElement('div')
    piano.className = 'piano'

    const whiteCount = 14 // 2 octaves
    const whiteW = 100 / whiteCount
    let whiteIndex = 0
    for (let semi = 0; semi < SEMIS_IN_VIEW; semi++) {
      const inOctave = semi % 12
      const isWhite = WHITE_SEMIS.includes(inOctave)
      const key = document.createElement('div')
      key.dataset.semi = String(semi)
      if (isWhite) {
        key.className = 'key-w'
        piano.appendChild(key)
        whiteIndex++
      } else {
        key.className = 'key-b'
        key.style.left = `${whiteIndex * whiteW - whiteW * 0.3}%`
        key.style.width = `${whiteW * 0.6}%`
        piano.appendChild(key)
      }
      const hint = KEY_HINTS[semi]
      if (hint) {
        const span = document.createElement('span')
        span.className = 'key-hint'
        span.textContent = hint
        key.appendChild(span)
      }
      this.keys.set(semi, key)
    }

    this.bindPointers(piano)
    this.el.appendChild(piano)
  }

  setOctave(octave: number): void {
    this.baseOctave = octave
    // notes under held pointers are ended by the keyboard panic that precedes
    // octave shifts; visual state resets here
    this.clearHighlights()
  }

  highlight(note: number, on: boolean): void {
    const semi = note - (this.baseOctave + 1) * 12
    this.keys.get(semi)?.classList.toggle('key-down', on)
  }

  clearHighlights(): void {
    for (const key of this.keys.values()) key.classList.remove('key-down')
  }

  private noteAt(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const target = el?.closest<HTMLElement>('[data-semi]')
    if (!target) return null
    return (this.baseOctave + 1) * 12 + Number(target.dataset.semi)
  }

  private bindPointers(piano: HTMLElement): void {
    piano.addEventListener('pointerdown', e => {
      e.preventDefault()
      try {
        piano.setPointerCapture(e.pointerId)
      } catch {
        // synthetic events have no active pointer; glissando still works
      }
      const note = this.noteAt(e.clientX, e.clientY)
      if (note === null) return
      this.pointers.set(e.pointerId, note)
      this.handlers.noteOn(note)
      this.highlight(note, true)
    })
    piano.addEventListener('pointermove', e => {
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
    piano.addEventListener('pointerup', end)
    piano.addEventListener('pointercancel', end)
  }
}
