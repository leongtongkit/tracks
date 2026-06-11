// Computer-keyboard note input: two-manual FL-Studio-style layout using all
// four rows. Z-row + S-row = lower manual; Q-row + number row = upper manual
// (one octave up). ArrowUp/ArrowDown shift octaves. Tab bends up, Left Shift
// bends down. Uses event.code (physical position) so AZERTY/QWERTZ play the
// same shape.

const LOWER: Record<string, number> = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7,
  KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13, Period: 14,
  Semicolon: 15, Slash: 16,
}

const UPPER: Record<string, number> = {
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18,
  KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25,
  KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, Equal: 30, BracketRight: 31,
}

const KEY_TO_SEMITONE: Record<string, number> = { ...LOWER, ...UPPER }

const BEND_SEMITONES = 2

export interface KeyboardHandlers {
  noteOn(note: number): void
  noteOff(note: number): void
  allNotesOff(): void
  bend?(semitones: number): void
  octaveChanged?(octave: number): void
}

export class KeyboardInput {
  octave = 4 // lower-manual C on KeyZ = C4 = MIDI 60
  private readonly down = new Map<string, number>() // code -> sounding MIDI note
  private bendUp = false
  private bendDown = false
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
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault()
      this.setOctave(this.octave + (e.code === 'ArrowDown' ? -1 : 1))
      return
    }
    if (e.code === 'Tab') {
      e.preventDefault()
      this.bendUp = true
      this.applyBend()
      return
    }
    if (e.code === 'ShiftLeft') {
      this.bendDown = true
      this.applyBend()
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
    if (e.code === 'Tab') {
      this.bendUp = false
      this.applyBend()
      return
    }
    if (e.code === 'ShiftLeft') {
      this.bendDown = false
      this.applyBend()
      return
    }
    const note = this.down.get(e.code)
    if (note === undefined) return
    this.down.delete(e.code)
    this.handlers.noteOff(note)
  }

  private applyBend(): void {
    const semis = (this.bendUp ? BEND_SEMITONES : 0) - (this.bendDown ? BEND_SEMITONES : 0)
    this.handlers.bend?.(semis)
  }

  private panic = (): void => {
    this.down.clear()
    this.bendUp = false
    this.bendDown = false
    this.handlers.bend?.(0)
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
