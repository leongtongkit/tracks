// The automatable channel-strip parameters: label, range, display format, and
// how the value relates to the static mixer control. UI and engine both read
// this so a lane can drive any of them.

import type { AutoTarget, MixerState } from './project'

export interface AutoTargetMeta {
  key: AutoTarget
  label: string
  min: number
  max: number
  fmt: (v: number) => string
  // value when the parameter is NOT automated (used to seed write-mode and to
  // restore the param after automation is cleared)
  staticValue: (m: MixerState) => number
}

const pct = (v: number): string => `${Math.round(v * 100)}`
const db = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(0)}`
const panFmt = (v: number): string =>
  Math.abs(v) < 0.05 ? 'C' : v < 0 ? `L${Math.round(-v * 50)}` : `R${Math.round(v * 50)}`

export const AUTO_TARGETS: AutoTargetMeta[] = [
  { key: 'volume', label: 'Volume', min: 0, max: 1, fmt: pct, staticValue: m => m.volume },
  { key: 'pan', label: 'Pan', min: -1, max: 1, fmt: panFmt, staticValue: m => m.pan },
  { key: 'sendA', label: 'Reverb send', min: 0, max: 1, fmt: pct, staticValue: m => m.sendA },
  { key: 'sendB', label: 'Delay send', min: 0, max: 1, fmt: pct, staticValue: m => m.sendB },
  { key: 'eqLow', label: 'EQ low', min: -18, max: 18, fmt: db, staticValue: m => m.eq[0]?.gain ?? 0 },
  { key: 'eqMid', label: 'EQ mid', min: -18, max: 18, fmt: db, staticValue: m => m.eq[1]?.gain ?? 0 },
  { key: 'eqHigh', label: 'EQ high', min: -18, max: 18, fmt: db, staticValue: m => m.eq[2]?.gain ?? 0 },
]

export function autoTargetMeta(key: AutoTarget): AutoTargetMeta {
  return AUTO_TARGETS.find(t => t.key === key) ?? AUTO_TARGETS[0]
}
