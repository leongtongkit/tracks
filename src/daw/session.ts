// Session view: a grid of clip "slots" (scenes × tracks) that, when launched,
// loop independently of the arrangement timeline. A launched clip repeats every
// clip.length beats from its launch beat; launching overrides the arrangement
// for that track. Pure scheduling helpers here are unit-tested; the live
// looping is booked by the transport pump through these.

import type { Clip } from './project'
import type { AudioEvent, SongEvent } from './transport'

// next launch-quantize boundary at/after `beat` (e.g. start of the next bar)
export function quantizeLaunch(beat: number, barBeats: number): number {
  if (barBeats <= 0) return beat
  return Math.ceil(beat / barBeats - 1e-9) * barBeats || 0 // normalise -0 → 0
}

// note events of a looped session clip launched at `launchBeat`, within [from, to)
export function sessionNoteEvents(clip: Clip, trackId: string, launchBeat: number, from: number, to: number): SongEvent[] {
  const len = clip.length
  if (len <= 0 || to <= launchBeat) return []
  const out: SongEvent[] = []
  const start = Math.max(from, launchBeat)
  const kStart = Math.max(0, Math.floor((start - launchBeat) / len))
  const kEnd = Math.ceil((to - launchBeat) / len)
  for (let k = kStart; k <= kEnd; k++) {
    const base = launchBeat + k * len
    if (base >= to) break
    for (const n of clip.notes) {
      if (n.start >= len) continue
      const abs = base + n.start
      if (abs >= from && abs < to && abs >= launchBeat) {
        out.push({ trackId, pitch: n.pitch, vel: n.vel, startBeat: abs, durBeats: Math.min(n.dur, len - n.start) })
      }
    }
  }
  return out
}

// audio re-triggers of a looped session clip launched at `launchBeat`, within [from, to)
export function sessionAudioEvents(clip: Clip, trackId: string, launchBeat: number, from: number, to: number): AudioEvent[] {
  if (!clip.audio || clip.length <= 0 || to <= launchBeat) return []
  const len = clip.length
  const out: AudioEvent[] = []
  const start = Math.max(from, launchBeat)
  const kStart = Math.max(0, Math.floor((start - launchBeat) / len))
  const kEnd = Math.ceil((to - launchBeat) / len)
  for (let k = kStart; k <= kEnd; k++) {
    const base = launchBeat + k * len
    if (base >= to) break
    if (base >= from && base >= launchBeat) {
      out.push({ trackId, region: clip.audio, startBeat: base, durBeats: len })
    }
  }
  return out
}
