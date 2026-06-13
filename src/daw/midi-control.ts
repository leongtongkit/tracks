// Thin indirection so the Settings panel can list/select MIDI devices without
// importing main.ts (which would be circular). main.ts registers the live
// session here after Web MIDI initializes.

let getInputs: () => string[] = () => []
let setInput: (name: string | null) => void = () => {}

export function registerMidiControl(inputs: () => string[], active: (name: string | null) => void): void {
  getInputs = inputs
  setInput = active
}

export function midiInputs(): string[] {
  return getInputs()
}

export function setMidiInput(name: string | null): void {
  setInput(name)
}
