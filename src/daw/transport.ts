// Beat-based song transport on the proven two-clock pattern: a coarse JS
// interval books sample-accurate events a small window ahead. Loop wraps
// re-anchor the beat→time mapping so timing stays exact across passes.

import type { Project, TrackData } from './project'

export interface SongEvent {
  trackId: string
  pitch: number
  vel: number
  startBeat: number // absolute timeline beats
  durBeats: number
}

export interface TransportEvents {
  noteOn(trackId: string, pitch: number, vel: number, t: number): void
  noteOff(trackId: string, pitch: number, t: number): void
  click?(t: number, accent: boolean): void
  onWrap?(): void
}

const LOOKAHEAD_S = 0.12
const TICK_MS = 25
const CHUNK_BEATS = 1

// Pure: every note event whose absolute start lands in [from, to).
// Notes are trimmed to their clip's bounds.
export function collectEvents(tracks: TrackData[], from: number, to: number): SongEvent[] {
  const out: SongEvent[] = []
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.start >= to || clip.start + clip.length <= from) continue
      for (const note of clip.notes) {
        if (note.start >= clip.length) continue
        const abs = clip.start + note.start
        if (abs >= from && abs < to) {
          out.push({
            trackId: track.id,
            pitch: note.pitch,
            vel: note.vel,
            startBeat: abs,
            durBeats: Math.min(note.dur, clip.length - note.start),
          })
        }
      }
    }
  }
  return out
}

export class Transport {
  playing = false
  metronome = false

  private anchorTime = 0 // ctx time at anchorBeat
  private anchorBeat = 0
  private scanBeat = 0
  private stoppedAt = 0
  private spbCached = 0.5
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly getNow: () => number
  private readonly getProject: () => Project
  private readonly events: TransportEvents

  constructor(opts: { getNow: () => number; getProject: () => Project; events: TransportEvents }) {
    this.getNow = opts.getNow
    this.getProject = opts.getProject
    this.events = opts.events
  }

  beatToTime(beat: number): number {
    return this.anchorTime + (beat - this.anchorBeat) * this.spbCached
  }

  positionBeat(now = this.getNow()): number {
    if (!this.playing) return this.stoppedAt
    return this.anchorBeat + (now - this.anchorTime) / this.spbCached
  }

  start(fromBeat = this.stoppedAt): void {
    if (this.playing) return
    this.playing = true
    this.spbCached = 60 / this.getProject().bpm
    this.anchorBeat = fromBeat
    this.scanBeat = fromBeat
    this.anchorTime = this.getNow() + 0.06
    this.timer = setInterval(() => this.pump(), TICK_MS)
    this.pump()
  }

  stop(): void {
    if (!this.playing) return
    this.stoppedAt = this.positionBeat()
    this.playing = false
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  toggle(): boolean {
    if (this.playing) this.stop()
    else this.start()
    return this.playing
  }

  setPosition(beat: number): void {
    this.stoppedAt = Math.max(0, beat)
    if (this.playing) {
      this.anchorBeat = this.stoppedAt
      this.anchorTime = this.getNow() + 0.03
      this.scanBeat = this.stoppedAt
    }
  }

  // Call when the project BPM changes so position holds steady: the current
  // position is computed with the OLD tempo, then the mapping switches over.
  reanchor(): void {
    if (!this.playing) {
      this.spbCached = 60 / this.getProject().bpm
      return
    }
    const now = this.getNow()
    this.anchorBeat = this.anchorBeat + (now - this.anchorTime) / this.spbCached
    this.anchorTime = now
    this.spbCached = 60 / this.getProject().bpm
  }

  // Books all events due inside the lookahead window. Public for tests.
  pump(now = this.getNow()): SongEvent[] {
    if (!this.playing) return []
    const booked: SongEvent[] = []
    const project = this.getProject()
    const targetTime = now + LOOKAHEAD_S
    let safety = 0

    while (this.beatToTime(this.scanBeat) < targetTime && safety++ < 64) {
      const loop = project.loop
      const loopActive = loop.on && loop.end > loop.start + 1e-9
      let sliceEnd = this.scanBeat + CHUNK_BEATS
      if (loopActive && this.scanBeat < loop.end) sliceEnd = Math.min(sliceEnd, loop.end)

      const events = collectEvents(project.tracks, this.scanBeat, sliceEnd)
      const spb = this.spbCached
      for (const ev of events) {
        const tOn = this.beatToTime(ev.startBeat)
        this.events.noteOn(ev.trackId, ev.pitch, ev.vel, tOn)
        this.events.noteOff(ev.trackId, ev.pitch, tOn + Math.max(0.02, ev.durBeats * spb - 0.01))
        booked.push(ev)
      }
      if (this.metronome && this.events.click) {
        for (let b = Math.ceil(this.scanBeat - 1e-9); b < sliceEnd; b++) {
          this.events.click(this.beatToTime(b), b % 4 === 0)
        }
      }

      this.scanBeat = sliceEnd
      if (loopActive && this.scanBeat >= loop.end - 1e-9) {
        // wrap: the instant of loop.end IS the instant of loop.start
        this.anchorTime = this.beatToTime(loop.end)
        this.anchorBeat = loop.start
        this.scanBeat = loop.start
        this.events.onWrap?.()
      }
    }
    return booked
  }
}
