// Computer-keyboard note input. Uses event.code (physical position) so
// AZERTY/QWERTZ layouts play the same shape. A-row = white keys, W-row =
// black keys, Z/X shift octaves.

const KEY_TO_SEMITONE: Record<string, number> = {
  KeyA: 0, // C
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12, // C one octave up
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
}

export interface KeyboardHandlers {
  noteOn(note: number): void
  noteOff(note: number): void
  allNotesOff(): void
  octaveChanged?(octave: number): void
}

export class KeyboardInput {
  octave = 4 // middle C = C4 = MIDI 60 on KeyA
  private readonly down = new Map<string, number>() // code -> sounding MIDI note
  private readonly handlers: KeyboardHandlers

  constructor(handlers: KeyboardHandlers) {
    this.handlers = handlers
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.panic)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') this.panic()
    })
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

    if (e.code === 'Escape') {
      this.panic()
      return
    }
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      this.setOctave(this.octave + (e.code === 'KeyZ' ? -1 : 1))
      return
    }

    const semi = KEY_TO_SEMITONE[e.code]
    if (semi === undefined || this.down.has(e.code)) return
    e.preventDefault()
    const note = (this.octave + 1) * 12 + semi
    this.down.set(e.code, note)
    this.handlers.noteOn(note)
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    const note = this.down.get(e.code)
    if (note === undefined) return
    this.down.delete(e.code)
    this.handlers.noteOff(note)
  }

  private panic = (): void => {
    this.down.clear()
    this.handlers.allNotesOff()
  }

  setOctave(oct: number): void {
    const next = Math.min(7, Math.max(0, oct))
    if (next === this.octave) return
    // shift octave under held keys cleanly: end old notes first
    this.panic()
    this.octave = next
    this.handlers.octaveChanged?.(next)
  }
}
