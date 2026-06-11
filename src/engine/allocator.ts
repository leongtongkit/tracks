// Pure voice-allocation policy, kept free of Web Audio so it unit-tests cleanly.

export type VoiceState = 'free' | 'active' | 'releasing'

export interface SlotInfo {
  state: VoiceState
  note: number
  startTime: number
  releaseEnd: number
}

// Returns the slot index to use for a new note.
// Policy: reuse the same note's slot (retrigger) → any free or expired-release
// slot → the longest-releasing slot → steal the oldest active slot.
export function chooseSlot(slots: readonly SlotInfo[], note: number, now: number): number {
  let free = -1
  let releasing = -1
  let releasingStart = Infinity
  let oldest = -1
  let oldestStart = Infinity

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    if (s.state === 'active' && s.note === note) return i
    if (s.state === 'free' || (s.state === 'releasing' && now >= s.releaseEnd)) {
      if (free === -1) free = i
    } else if (s.state === 'releasing') {
      if (s.startTime < releasingStart) {
        releasingStart = s.startTime
        releasing = i
      }
    } else if (s.startTime < oldestStart) {
      oldestStart = s.startTime
      oldest = i
    }
  }

  if (free !== -1) return free
  if (releasing !== -1) return releasing
  return oldest === -1 ? 0 : oldest
}

// Held-note stack for mono/legato: most recent note wins; releasing it falls
// back to the most recent still-held note.
export class NoteStack {
  private notes: number[] = []

  push(note: number): void {
    this.remove(note)
    this.notes.push(note)
  }

  remove(note: number): void {
    const i = this.notes.indexOf(note)
    if (i !== -1) this.notes.splice(i, 1)
  }

  top(): number | null {
    return this.notes.length ? this.notes[this.notes.length - 1] : null
  }

  clear(): void {
    this.notes.length = 0
  }

  get size(): number {
    return this.notes.length
  }
}

export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}
