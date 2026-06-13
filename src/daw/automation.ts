// Automation curve evaluation + AudioParam scheduling. Points are sorted by
// beat; each point's `shape` controls how the curve leaves it toward the next
// point: linear (ramp), hold (step — stays flat then jumps), or exp (ease).
// Before the first point the curve holds its first value; after the last, its
// last value.

import type { AutoPoint } from './project'

export function autoValueAt(points: AutoPoint[], beat: number, fallback: number): number {
  if (points.length === 0) return fallback
  if (beat <= points[0].beat) return points[0].value
  for (let i = 1; i < points.length; i++) {
    if (beat <= points[i].beat) {
      const a = points[i - 1]
      const b = points[i]
      if (a.shape === 'hold' && beat < b.beat) return a.value // step holds until we reach b
      const span = b.beat - a.beat
      if (span < 1e-9) return b.value
      const x = (beat - a.beat) / span
      const t = a.shape === 'exp' ? x * x : x
      return a.value + t * (b.value - a.value)
    }
  }
  return points[points.length - 1].value
}

// Book the curve over [fromBeat, toBeat) onto an AudioParam. Slices are
// contiguous, so each slice re-anchors with setValueAtTime and the junction is
// seamless. Shapes are realized per segment.
export function scheduleAutomation(
  param: AudioParam,
  points: AutoPoint[],
  fromBeat: number,
  toBeat: number,
  beatToTime: (beat: number) => number,
  fallback: number,
): void {
  if (points.length === 0) return
  param.setValueAtTime(autoValueAt(points, fromBeat, fallback), beatToTime(fromBeat))
  let last = fromBeat
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (p.beat <= fromBeat || p.beat > toBeat) continue
    const prev = points[i - 1]
    // the segment LEADING INTO p is shaped by the previous point's shape
    if (prev?.shape === 'hold') {
      // hold flat at prev.value until p's beat, then jump
      param.setValueAtTime(prev.value, beatToTime(p.beat))
      param.setValueAtTime(p.value, beatToTime(p.beat))
    } else if (prev?.shape === 'exp') {
      rampExp(param, prev, p, beatToTime)
    } else {
      param.linearRampToValueAtTime(p.value, beatToTime(p.beat))
    }
    last = p.beat
  }
  if (last < toBeat) {
    const end = autoValueAt(points, toBeat, fallback)
    const lastPt = points[points.length - 1]
    if (lastPt.shape === 'hold') param.setValueAtTime(end, beatToTime(toBeat))
    else param.linearRampToValueAtTime(end, beatToTime(toBeat))
  }
}

// exponentialRampToValueAtTime can't touch zero, so approximate the eased
// segment with a few short linear steps — robust across all value ranges.
function rampExp(param: AudioParam, a: AutoPoint, b: AutoPoint, beatToTime: (beat: number) => number): void {
  const STEPS = 8
  for (let s = 1; s <= STEPS; s++) {
    const x = s / STEPS
    const beat = a.beat + (b.beat - a.beat) * x
    const value = a.value + x * x * (b.value - a.value)
    param.linearRampToValueAtTime(value, beatToTime(beat))
  }
}
