// Beat-based song transport on the proven two-clock pattern: a coarse JS
// interval books sample-accurate events a small window ahead. Loop wraps
// re-anchor the beat→time mapping so timing stays exact across passes.

import { TempoMap, warpRate, type AudioRegion, type Clip, type Project, type TrackData } from './project'

// the leading silence renderProject prepends to every bounce (see render.ts
// startAt); a frozen clip skips it so the bounce sits flush on the timeline.
export const FROZEN_LEAD_SEC = 0.05

// the synthetic full-song audio clip a frozen track plays (its bounce)
export function frozenClip(track: TrackData): Clip | null {
  if (!track.frozen) return null
  return {
    id: '__frozen',
    start: 0,
    length: track.frozen.lengthBeats,
    notes: [],
    audio: { sampleId: track.frozen.sampleId, offsetSec: FROZEN_LEAD_SEC, gain: 1, warp: 'off', origBpm: 120, fadeIn: 0, fadeOut: 0 },
  }
}

// audio-bearing clips to schedule for a track: just the frozen bounce when
// frozen, otherwise its real audio clips. (Frozen tracks mute their own notes
// and original clips — the bounce already contains them.)
export function scheduledAudioClips(track: TrackData): Clip[] {
  if (track.frozen) {
    const c = frozenClip(track)
    return c ? [c] : []
  }
  return track.clips.filter(c => c.audio)
}

export interface SongEvent {
  trackId: string
  pitch: number
  vel: number
  startBeat: number // absolute timeline beats
  durBeats: number
}

export interface AudioEvent {
  trackId: string
  region: AudioRegion
  startBeat: number // absolute timeline beats
  durBeats: number
}

export interface TransportEvents {
  noteOn(trackId: string, pitch: number, vel: number, t: number): void
  noteOff(trackId: string, pitch: number, t: number): void
  // schedule an audio region: start playing at ctx-time t, from offsetSec into
  // the sample (source seconds), for at most durSec (source seconds), at `rate`
  audio?(trackId: string, region: AudioRegion, t: number, offsetSec: number, durSec: number, rate: number, fadeInSec?: number, fadeOutSec?: number): void
  audioStopAll?(at?: number): void
  // every booked slice, for time-scheduled things beyond notes (automation)
  slice?(fromBeat: number, toBeat: number, beatToTime: (beat: number) => number): void
  // playback jumped (stop/seek/wrap): cancel anything booked into the future
  discontinuity?(at?: number): void
  click?(t: number, accent: boolean): void
  onWrap?(): void
  // session view: tracks with a launched session clip are skipped by the
  // arrangement, and their looped clips are booked by sessionSlice instead
  sessionActiveTrack?(trackId: string): boolean
  sessionSlice?(fromBeat: number, toBeat: number, beatToTime: (beat: number) => number): void
}

const LOOKAHEAD_S = 0.12
const TICK_MS = 25
const CHUNK_BEATS = 1

// Pure: every note event whose absolute start lands in [from, to).
// Notes are trimmed to their clip's bounds.
export function collectEvents(tracks: TrackData[], from: number, to: number): SongEvent[] {
  const out: SongEvent[] = []
  for (const track of tracks) {
    if (track.frozen) continue // frozen tracks play their bounce, not live notes
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

// Pure: audio clips whose start lands in [from, to).
export function collectAudioEvents(tracks: TrackData[], from: number, to: number): AudioEvent[] {
  const out: AudioEvent[] = []
  for (const track of tracks) {
    for (const clip of scheduledAudioClips(track)) {
      if (!clip.audio) continue
      if (clip.start >= from && clip.start < to) {
        out.push({ trackId: track.id, region: clip.audio, startBeat: clip.start, durBeats: clip.length })
      }
    }
  }
  return out
}

// Pure: audio clips already sounding at atBeat (started earlier, not yet done).
export function straddlingAudio(
  tracks: TrackData[],
  atBeat: number,
): { trackId: string; region: AudioRegion; intoBeats: number; remainBeats: number }[] {
  const out: { trackId: string; region: AudioRegion; intoBeats: number; remainBeats: number }[] = []
  for (const track of tracks) {
    for (const clip of scheduledAudioClips(track)) {
      if (!clip.audio) continue
      if (clip.start < atBeat && clip.start + clip.length > atBeat) {
        out.push({
          trackId: track.id,
          region: clip.audio,
          intoBeats: atBeat - clip.start,
          remainBeats: clip.start + clip.length - atBeat,
        })
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
  private map = new TempoMap(120, []) // beat↔time map, rebuilt on tempo change
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly getNow: () => number
  private readonly getProject: () => Project
  private readonly events: TransportEvents

  constructor(opts: { getNow: () => number; getProject: () => Project; events: TransportEvents }) {
    this.getNow = opts.getNow
    this.getProject = opts.getProject
    this.events = opts.events
  }

  private rebuildMap(): void {
    const p = this.getProject()
    this.map = new TempoMap(p.bpm, p.tempoMap)
  }

  // wall-clock seconds spanned by the beat range [b0, b1] under the tempo map
  private wallBetween(b0: number, b1: number): number {
    return this.map.secAtBeat(b1) - this.map.secAtBeat(b0)
  }

  beatToTime(beat: number): number {
    return this.anchorTime + (this.map.secAtBeat(beat) - this.map.secAtBeat(this.anchorBeat))
  }

  positionBeat(now = this.getNow()): number {
    if (!this.playing) return this.stoppedAt
    return this.map.beatAtSec(this.map.secAtBeat(this.anchorBeat) + (now - this.anchorTime))
  }

  start(fromBeat = this.stoppedAt): void {
    if (this.playing) return
    this.playing = true
    this.rebuildMap()
    this.anchorBeat = fromBeat
    this.scanBeat = fromBeat
    this.anchorTime = this.getNow() + 0.06
    this.scheduleStraddlingAudio(fromBeat, this.anchorTime)
    this.timer = setInterval(() => this.pump(), TICK_MS)
    this.pump()
  }

  stop(): void {
    if (!this.playing) return
    this.stoppedAt = this.positionBeat()
    this.playing = false
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.events.audioStopAll?.()
    this.events.discontinuity?.()
  }

  // restart audio clips that should already be sounding at `beat`
  private scheduleStraddlingAudio(beat: number, t: number): void {
    if (!this.events.audio) return
    const project = this.getProject()
    const loop = project.loop
    const cutBeat = loop.on && loop.end > beat ? loop.end : Infinity
    for (const s of straddlingAudio(project.tracks, beat)) {
      const remain = Math.min(s.remainBeats, cutBeat - beat)
      const rate = warpRate(s.region, project.bpm)
      const clipStart = beat - s.intoBeats
      const clipEnd = beat + s.remainBeats
      const intoSec = this.wallBetween(clipStart, beat) * rate
      const remainSec = this.wallBetween(beat, beat + remain) * rate
      const fadeOutSec = this.wallBetween(clipEnd - s.region.fadeOut, clipEnd)
      this.events.audio(s.trackId, s.region, t, s.region.offsetSec + intoSec, remainSec, rate, 0, fadeOutSec)
    }
  }

  toggle(): boolean {
    if (this.playing) this.stop()
    else this.start()
    return this.playing
  }

  setPosition(beat: number): void {
    this.stoppedAt = Math.max(0, beat)
    if (this.playing) {
      this.events.audioStopAll?.()
      this.events.discontinuity?.()
      this.anchorBeat = this.stoppedAt
      this.anchorTime = this.getNow() + 0.03
      this.scanBeat = this.stoppedAt
      this.scheduleStraddlingAudio(this.stoppedAt, this.anchorTime)
    }
  }

  // Call when the project BPM changes so position holds steady: the current
  // position is computed with the OLD tempo, then the mapping switches over.
  reanchor(): void {
    if (!this.playing) {
      this.rebuildMap()
      return
    }
    const beatNow = this.positionBeat() // computed with the OLD map
    this.rebuildMap()
    this.anchorBeat = beatNow
    this.anchorTime = this.getNow()
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

      const sessionOn = this.events.sessionActiveTrack
      const events = collectEvents(project.tracks, this.scanBeat, sliceEnd).filter(ev => !sessionOn?.(ev.trackId))
      // session-view looped clips override the arrangement on their tracks
      this.events.sessionSlice?.(this.scanBeat, sliceEnd, b => this.beatToTime(b))
      for (const ev of events) {
        const tOn = this.beatToTime(ev.startBeat)
        this.events.noteOn(ev.trackId, ev.pitch, ev.vel, tOn)
        this.events.noteOff(ev.trackId, ev.pitch, Math.max(tOn + 0.02, this.beatToTime(ev.startBeat + ev.durBeats) - 0.01))
        booked.push(ev)
      }
      this.events.slice?.(this.scanBeat, sliceEnd, b => this.beatToTime(b))
      if (this.events.audio) {
        for (const ev of collectAudioEvents(project.tracks, this.scanBeat, sliceEnd)) {
          if (sessionOn?.(ev.trackId)) continue
          // a clip crossing the loop end gets cut there, exactly at the wrap
          let durBeats = ev.durBeats
          if (loopActive && ev.startBeat + durBeats > loop.end) durBeats = loop.end - ev.startBeat
          const rate = warpRate(ev.region, project.bpm)
          const end = ev.startBeat + durBeats
          this.events.audio(
            ev.trackId,
            ev.region,
            this.beatToTime(ev.startBeat),
            ev.region.offsetSec,
            this.wallBetween(ev.startBeat, end) * rate,
            rate,
            this.wallBetween(ev.startBeat, ev.startBeat + ev.region.fadeIn),
            this.wallBetween(end - ev.region.fadeOut, end),
          )
        }
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
        this.events.discontinuity?.(this.anchorTime)
        this.scheduleStraddlingAudio(loop.start, this.anchorTime)
        this.events.onWrap?.()
      }
    }
    return booked
  }
}
