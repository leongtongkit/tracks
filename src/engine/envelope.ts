import type { ADSR } from '../patch/schema'

// All envelope scheduling lives here so the cancelAndHoldAtTime fallback
// (Firefox shipped it late) is isolated to one file.
// Envelopes run between `base` and `base + peak` so the same code drives
// amp gain (base 0) and filter detune (base = key-tracking offset).

const hasCancelAndHold =
  typeof AudioParam !== 'undefined' &&
  'cancelAndHoldAtTime' in AudioParam.prototype

export function triggerAttack(
  param: AudioParam,
  env: ADSR,
  t0: number,
  base: number,
  peak: number,
): void {
  param.cancelScheduledValues(t0)
  param.setValueAtTime(base, t0)
  param.linearRampToValueAtTime(base + peak, t0 + env.a)
  // Exponential-ish decay toward sustain; tau = d/4 reaches ~98% by t0+a+d.
  param.setTargetAtTime(base + peak * env.s, t0 + env.a, Math.max(0.001, env.d / 4))
}

export function triggerRelease(param: AudioParam, env: ADSR, t0: number, base = 0): void {
  holdAt(param, t0)
  param.setTargetAtTime(base, t0, Math.max(0.001, env.r / 4))
}

// Stop pending automation and pin the param at its in-flight value.
export function holdAt(param: AudioParam, t0: number): void {
  if (hasCancelAndHold) {
    ;(param as AudioParam & { cancelAndHoldAtTime(t: number): void }).cancelAndHoldAtTime(t0)
  } else {
    // .value reflects current automation in implementations lacking
    // cancelAndHoldAtTime; close enough for a fallback path.
    const current = param.value
    param.cancelScheduledValues(t0)
    param.setValueAtTime(current, t0)
  }
}

// Time after release start when the voice is inaudible and safe to reclaim.
export function releaseEndTime(env: ADSR, tRelease: number): number {
  return tRelease + env.r + 0.05
}
