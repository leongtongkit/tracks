// Automation curve evaluation + AudioParam scheduling. Points are sorted by
// beat with linear interpolation between them; the curve holds its first
// value before the first point and its last value after the last.
//
// Automation rides ON TOP of the mixer: volume automation is a 0..1
// multiplier over the fader, pan automation adds onto the pan knob.

import type { AutoPoint } from './project'

export function autoValueAt(points: AutoPoint[], beat: number, fallback: number): number {
  if (points.length === 0) return fallback
  if (beat <= points[0].beat) return points[0].value
  for (let i = 1; i < points.length; i++) {
    if (beat <= points[i].beat) {
      const a = points[i - 1]
      const b = points[i]
      const span = b.beat - a.beat
      if (span < 1e-9) return b.value
      return a.value + ((beat - a.beat) / span) * (b.value - a.value)
    }
  }
  return points[points.length - 1].value
}

// Book the curve over [fromBeat, toBeat) onto an AudioParam as linear ramps.
// Slices are contiguous, so each slice re-anchors with setValueAtTime and the
// junction is seamless.
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
  for (const p of points) {
    if (p.beat <= fromBeat || p.beat > toBeat) continue
    param.linearRampToValueAtTime(p.value, beatToTime(p.beat))
    last = p.beat
  }
  if (last < toBeat) {
    param.linearRampToValueAtTime(autoValueAt(points, toBeat, fallback), beatToTime(toBeat))
  }
}
