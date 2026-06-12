// Central DAW state: the project document, the audio graph, the transport,
// selection/arm state, and a coarse change bus the UI re-renders from.

import { defaultProject, newId, newTrack, type Clip, type Project, type TrackData } from './project'
import { SongEngine } from './song-engine'
import { Transport } from './transport'

export type DawEvent = 'project' | 'tracks' | 'clips' | 'selection' | 'transport' | 'mixer'

const TRACK_PRESETS = ['Fat Saw', 'EP Glow', 'Retro Solo', 'Warm Pad', 'Pop Pluck', 'FM Bell', 'Synth Brass', 'Dub Wob']

export class DawApp {
  project: Project = defaultProject()
  song: SongEngine | null = null
  readonly transport: Transport
  selectedClip: { trackId: string; clipId: string } | null = null
  armedTrackId: string | null = null
  recording = false

  private ctx: AudioContext | null = null
  private clickGain: GainNode | null = null
  private readonly listeners = new Map<DawEvent, Set<() => void>>()

  constructor() {
    this.transport = new Transport({
      getNow: () => (this.ctx ? this.ctx.currentTime : 0),
      getProject: () => this.project,
      events: {
        noteOn: (trackId, pitch, vel, t) => this.song?.noteOn(trackId, pitch, vel, t),
        noteOff: (trackId, pitch, t) => this.song?.noteOff(trackId, pitch, t),
        click: (t, accent) => this.click(t, accent),
      },
    })
    this.armedTrackId = this.project.tracks[0]?.id ?? null
  }

  // ---------- events ----------

  on(event: DawEvent, fn: () => void): void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(fn)
  }

  emit(...events: DawEvent[]): void {
    for (const ev of events) {
      for (const fn of this.listeners.get(ev) ?? []) fn()
    }
  }

  // ---------- audio ----------

  ensureAudio(): SongEngine {
    if (!this.song) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
      this.song = new SongEngine(this.ctx)
      void this.song.syncTracks(this.project)
      this.clickGain = this.ctx.createGain()
      this.clickGain.gain.value = 0.4
      this.clickGain.connect(this.ctx.destination)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.ctx && this.ctx.state !== 'running') {
          this.ctx.resume().catch(() => {})
        }
      })
    }
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {})
    return this.song
  }

  private click(t: number, accent: boolean): void {
    if (!this.ctx || !this.clickGain) return
    const osc = this.ctx.createOscillator()
    const env = this.ctx.createGain()
    osc.frequency.value = accent ? 1660 : 1108
    env.gain.setValueAtTime(0.9, t)
    env.gain.setTargetAtTime(0, t + 0.012, 0.012)
    osc.connect(env)
    env.connect(this.clickGain)
    osc.start(t)
    osc.stop(t + 0.09)
    osc.onended = () => {
      osc.disconnect()
      env.disconnect()
    }
  }

  // ---------- transport ----------

  togglePlay(): void {
    this.ensureAudio()
    if (this.transport.playing) {
      this.transport.stop()
      this.song?.allNotesOff()
    } else {
      this.transport.start()
    }
    this.emit('transport')
  }

  rewind(): void {
    this.transport.setPosition(0)
    this.emit('transport')
  }

  setBpm(bpm: number): void {
    this.project.bpm = Math.min(240, Math.max(40, Math.round(bpm)))
    this.transport.reanchor()
    this.emit('project')
  }

  // ---------- tracks ----------

  track(id: string): TrackData | undefined {
    return this.project.tracks.find(t => t.id === id)
  }

  addTrack(): TrackData {
    const preset = TRACK_PRESETS[this.project.tracks.length % TRACK_PRESETS.length]
    const track = newTrack(`Track ${this.project.tracks.length + 1}`, preset)
    track.name = preset
    this.project.tracks.push(track)
    void this.song?.syncTracks(this.project)
    this.emit('tracks')
    return track
  }

  removeTrack(id: string): void {
    const i = this.project.tracks.findIndex(t => t.id === id)
    if (i === -1) return
    this.project.tracks.splice(i, 1)
    if (this.selectedClip?.trackId === id) this.selectedClip = null
    if (this.armedTrackId === id) this.armedTrackId = this.project.tracks[0]?.id ?? null
    void this.song?.syncTracks(this.project)
    this.emit('tracks', 'selection')
  }

  setMixer(id: string, patch: Partial<TrackData['mixer']>): void {
    const track = this.track(id)
    if (!track) return
    Object.assign(track.mixer, patch)
    this.song?.applyMixers(this.project)
    this.emit('mixer')
  }

  armTrack(id: string): void {
    this.armedTrackId = id
    this.emit('tracks')
  }

  // ---------- clips ----------

  clip(ref: { trackId: string; clipId: string } | null): Clip | null {
    if (!ref) return null
    return this.track(ref.trackId)?.clips.find(c => c.id === ref.clipId) ?? null
  }

  addClip(trackId: string, startBeat: number, length = 4): Clip | null {
    const track = this.track(trackId)
    if (!track) return null
    const clip: Clip = { id: newId(), start: Math.max(0, startBeat), length, notes: [] }
    track.clips.push(clip)
    this.selectClip(trackId, clip.id)
    this.emit('clips')
    return clip
  }

  deleteClip(trackId: string, clipId: string): void {
    const track = this.track(trackId)
    if (!track) return
    track.clips = track.clips.filter(c => c.id !== clipId)
    if (this.selectedClip?.clipId === clipId) this.selectedClip = null
    this.emit('clips', 'selection')
  }

  selectClip(trackId: string, clipId: string): void {
    this.selectedClip = { trackId, clipId }
    this.emit('selection')
  }

  // live keyboard/MIDI input goes to the armed track
  private readonly heldRec = new Map<number, { startBeat: number; vel: number }>()

  liveNoteOn(pitch: number, vel = 1): void {
    if (!this.armedTrackId) return
    this.ensureAudio().noteOn(this.armedTrackId, pitch, vel)
    if (this.recording && this.transport.playing) {
      this.heldRec.set(pitch, { startBeat: this.transport.positionBeat(), vel })
    }
  }

  liveNoteOff(pitch: number): void {
    if (!this.armedTrackId) return
    this.song?.noteOff(this.armedTrackId, pitch)
    const held = this.heldRec.get(pitch)
    if (held) {
      this.heldRec.delete(pitch)
      this.commitRecordedNote(pitch, held.startBeat, this.transport.positionBeat(), held.vel)
    }
  }

  liveBend(semitones: number): void {
    if (!this.armedTrackId) return
    this.song?.channel(this.armedTrackId)?.engine.setBend(semitones)
  }

  toggleRecord(): void {
    this.recording = !this.recording
    if (this.recording && !this.transport.playing) this.togglePlay()
    this.emit('transport')
  }

  // Write a played note into a clip on the armed track, creating or extending
  // the clip as needed. Loop wraps can make end < start; floor the duration.
  private commitRecordedNote(pitch: number, startBeat: number, endBeat: number, vel: number): void {
    const track = this.track(this.armedTrackId ?? '')
    if (!track) return
    let clip = track.clips.find(c => startBeat >= c.start && startBeat < c.start + c.length)
    if (!clip) {
      const at = Math.floor(startBeat / 4) * 4
      clip = { id: newId(), start: at, length: 4, notes: [] }
      track.clips.push(clip)
    }
    const rel = startBeat - clip.start
    const dur = Math.max(0.125, endBeat - startBeat)
    if (rel + dur > clip.length) clip.length = Math.ceil(rel + dur)
    clip.notes.push({ start: rel, dur, pitch, vel })
    this.emit('clips')
  }
}

