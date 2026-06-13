// Web MIDI note input (Chrome/Edge). Requested on user action, never on load.
// Used by both the standalone synth and the DAW.

export interface MidiHandlers {
  noteOn(note: number, velocity: number): void
  noteOff(note: number): void
  bend(semitones: number): void
}

export type MidiStatus = 'ok' | 'unsupported' | 'denied' | 'no-inputs'

// Pure decode of one raw MIDI message → a typed event (null = ignored).
export type MidiEvent =
  | { type: 'noteOn'; note: number; velocity: number }
  | { type: 'noteOff'; note: number }
  | { type: 'bend'; semitones: number }
  | { type: 'sustain'; down: boolean }
  | null

export function parseMidiMessage(data: Uint8Array | number[]): MidiEvent {
  if (!data || data.length < 2) return null
  const status = data[0] & 0xf0
  if (status === 0x90 && data[2] > 0) return { type: 'noteOn', note: data[1], velocity: data[2] / 127 }
  if (status === 0x80 || (status === 0x90 && data[2] === 0)) return { type: 'noteOff', note: data[1] }
  if (status === 0xe0 && data.length >= 3) {
    const raw = (data[2] << 7) | data[1] // 0..16383, center 8192
    return { type: 'bend', semitones: ((raw - 8192) / 8192) * 2 }
  }
  if (status === 0xb0 && data[1] === 64) return { type: 'sustain', down: data[2] >= 64 } // CC64
  return null
}

// Applies a MidiEvent to handlers, with sustain-pedal semantics: while the
// pedal is down, note-offs are deferred until release. Stateful, testable.
export class MidiRouter {
  private readonly handlers: MidiHandlers
  private sustained = false
  private readonly held = new Set<number>() // notes still sounding (pedal-held)
  private readonly down = new Set<number>() // keys physically pressed

  constructor(handlers: MidiHandlers) {
    this.handlers = handlers
  }

  handle(ev: MidiEvent): void {
    if (!ev) return
    switch (ev.type) {
      case 'noteOn':
        this.down.add(ev.note)
        this.held.add(ev.note)
        this.handlers.noteOn(ev.note, ev.velocity)
        break
      case 'noteOff':
        this.down.delete(ev.note)
        if (this.sustained) break // hold until pedal release
        this.held.delete(ev.note)
        this.handlers.noteOff(ev.note)
        break
      case 'bend':
        this.handlers.bend(ev.semitones)
        break
      case 'sustain':
        this.sustained = ev.down
        if (!ev.down) {
          // release every sounding note whose key is no longer pressed
          for (const note of [...this.held]) {
            if (!this.down.has(note)) {
              this.held.delete(note)
              this.handlers.noteOff(note)
            }
          }
        }
        break
    }
  }
}

export interface MidiSession {
  status: MidiStatus
  inputs: string[]
  setActiveInput(name: string | null): void // null = listen to all
}

export async function initMidi(handlers: MidiHandlers): Promise<MidiSession> {
  const router = new MidiRouter(handlers)
  if (!('requestMIDIAccess' in navigator)) {
    return { status: 'unsupported', inputs: [], setActiveInput: () => {} }
  }
  let access: MIDIAccess
  try {
    access = await navigator.requestMIDIAccess({ sysex: false })
  } catch {
    return { status: 'denied', inputs: [], setActiveInput: () => {} }
  }

  let activeInput: string | null = null // null = all devices

  const attach = (input: MIDIInput): void => {
    input.onmidimessage = e => {
      if (activeInput !== null && (input.name ?? 'MIDI device') !== activeInput) return
      router.handle(parseMidiMessage(e.data ?? []))
    }
  }

  for (const input of access.inputs.values()) attach(input)
  access.onstatechange = e => {
    const port = e.port
    if (port && port.type === 'input' && port.state === 'connected') attach(port as MIDIInput)
  }

  const names = [...access.inputs.values()].map(i => i.name ?? 'MIDI device')
  return {
    status: names.length ? 'ok' : 'no-inputs',
    inputs: names,
    setActiveInput: name => {
      activeInput = name
    },
  }
}
