// Web MIDI note input (Chrome/Edge). Requested on user action, never on load.

export interface MidiHandlers {
  noteOn(note: number, velocity: number): void
  noteOff(note: number): void
  bend(semitones: number): void
}

export type MidiStatus = 'ok' | 'unsupported' | 'denied' | 'no-inputs'

export async function initMidi(handlers: MidiHandlers): Promise<{ status: MidiStatus; inputs: string[] }> {
  if (!('requestMIDIAccess' in navigator)) return { status: 'unsupported', inputs: [] }
  let access: MIDIAccess
  try {
    access = await navigator.requestMIDIAccess({ sysex: false })
  } catch {
    return { status: 'denied', inputs: [] }
  }

  const attach = (input: MIDIInput): void => {
    input.onmidimessage = e => {
      const data = e.data
      if (!data || data.length < 2) return
      const status = data[0] & 0xf0
      if (status === 0x90 && data[2] > 0) {
        handlers.noteOn(data[1], data[2] / 127)
      } else if (status === 0x80 || (status === 0x90 && data[2] === 0)) {
        handlers.noteOff(data[1])
      } else if (status === 0xe0 && data.length >= 3) {
        const raw = (data[2] << 7) | data[1] // 0..16383, center 8192
        handlers.bend(((raw - 8192) / 8192) * 2)
      }
    }
  }

  for (const input of access.inputs.values()) attach(input)
  access.onstatechange = e => {
    const port = e.port
    if (port && port.type === 'input' && port.state === 'connected') attach(port as MIDIInput)
  }

  const names = [...access.inputs.values()].map(i => i.name ?? 'MIDI device')
  return { status: names.length ? 'ok' : 'no-inputs', inputs: names }
}
