// Computer-key layouts for percussion tracks. Drums and the 16-pad bank are not
// chromatic, so a piano mapping makes no sense — instead each key triggers a
// specific drum / pad (finger-drumming layout), and the editors label each pad
// with its key. Live keyboard input resolves codes through these.

import { DRUM_ORDER } from './instruments/drums'
import { PAD_BASE_PITCH, PAD_COUNT } from './project'

const stripCode = (code: string): string => code.replace('Key', '').replace('Digit', '')

// home row = the main drums, Q-row = the extras; aligned to DRUM_ORDER index
const DRUM_CODES = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU']

// label shown on DRUM_ORDER[i]'s pad
export const DRUM_KEY_LABEL: string[] = DRUM_CODES.map(stripCode)

export function drumKeyNote(code: string): number | undefined {
  const i = DRUM_CODES.indexOf(code)
  return i >= 0 && i < DRUM_ORDER.length ? DRUM_ORDER[i].pitch : undefined
}

// 4×4 MPC grid: bottom-left (Z) = pad 0 = MIDI 36, rows go up Z→A→Q→number row
const PAD_CODES = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'Digit1', 'Digit2', 'Digit3', 'Digit4']

// label shown on pad index i (0-based)
export const PAD_KEY_LABEL: string[] = PAD_CODES.map(stripCode)

export function padKeyNote(code: string): number | undefined {
  const i = PAD_CODES.indexOf(code)
  return i >= 0 && i < PAD_COUNT ? PAD_BASE_PITCH + i : undefined
}
