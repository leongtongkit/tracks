// Central DAW state: the project document, the audio graph, the transport,
// selection/arm state, undo history, and a coarse change bus the UI
// re-renders from.

import { History } from './history'
import {
  defaultProject,
  newId,
  newTrack,
  type Clip,
  type KeySig,
  type Project,
  type TrackData,
  type TrackKind,
} from './project'
import { SongEngine } from './song-engine'
import { Transport } from './transport'

export type DawEvent = 'project' | 'tracks' | 'clips' | 'selection' | 'transport' | 'mixer'

const TRACK_PRESETS = ['Fat Saw', 'EP Glow', 'Retro Solo', 'Warm Pad', 'Pop Pluck', 'FM Bell', 'Synth Brass', 'Dub Wob']

export class DawApp {
  project: Project = defaultProject()
  song: SongEngine | null = null
  readonly transport: Transport
  readonly history: History
  selectedClip: { trackId: string; clipId: string } | null = null
  armedTrackId: string | null = null
  recording = false

  private ctx: AudioContext | null = null
  private clickGain: GainNode | null = null
  private clipboard: Clip | null = null
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
    this.history = new History(this)
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

  // take an undo snapshot before a mutation; same-label calls coalesce
  checkpoint(label: string): void {
    this.history.checkpoint(label)
  }

  undo(): void {
    this.history.undo()
  }

  redo(): void {
    this.history.redo()
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

  audioCtx(): AudioContext | null {
    return this.ctx
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
    this.checkpoint('bpm')
    this.project.bpm = Math.min(240, Math.max(40, Math.round(bpm)))
    this.transport.reanchor()
    this.emit('project')
  }

  setKey(key: Partial<KeySig>): void {
    this.checkpoint('key')
    Object.assign(this.project.key, key)
    this.emit('project')
  }

  // ---------- tracks ----------

  track(id: string): TrackData | undefined {
    return this.project.tracks.find(t => t.id === id)
  }

  addTrack(kind: TrackKind = 'synth'): TrackData {
    this.checkpoint('add track')
    let track: TrackData
    if (kind === 'synth') {
      const preset = TRACK_PRESETS[this.project.tracks.length % TRACK_PRESETS.length]
      track = newTrack(preset, { preset })
    } else {
      const names: Record<TrackKind, string> = { synth: 'Synth', drums: 'Drums', sampler: 'Sampler', audio: 'Audio' }
      track = newTrack(names[kind], { kind })
    }
    this.project.tracks.push(track)
    void this.song?.syncTracks(this.project)
    this.emit('tracks')
    return track
  }

  removeTrack(id: string): void {
    const i = this.project.tracks.findIndex(t => t.id === id)
    if (i === -1) return
    this.checkpoint('remove track')
    this.project.tracks.splice(i, 1)
    if (this.selectedClip?.trackId === id) this.selectedClip = null
    if (this.armedTrackId === id) this.armedTrackId = this.project.tracks[0]?.id ?? null
    void this.song?.syncTracks(this.project)
    this.emit('tracks', 'selection')
  }

  renameTrack(id: string, name: string): void {
    const track = this.track(id)
    if (!track || !name.trim()) return
    this.checkpoint('rename track')
    track.name = name.trim().slice(0, 24)
    this.emit('tracks')
  }

  setMixer(id: string, patch: Partial<TrackData['mixer']>): void {
    const track = this.track(id)
    if (!track) return
    this.checkpoint(`mixer ${id} ${Object.keys(patch).join(',')}`)
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
    this.checkpoint('add clip')
    const clip: Clip = { id: newId(), start: Math.max(0, startBeat), length, notes: [] }
    track.clips.push(clip)
    this.selectClip(trackId, clip.id)
    this.emit('clips')
    return clip
  }

  deleteClip(trackId: string, clipId: string): void {
    const track = this.track(trackId)
    if (!track) return
    this.checkpoint('delete clip')
    track.clips = track.clips.filter(c => c.id !== clipId)
    if (this.selectedClip?.clipId === clipId) this.selectedClip = null
    this.emit('clips', 'selection')
  }

  selectClip(trackId: string, clipId: string): void {
    this.selectedClip = { trackId, clipId }
    this.emit('selection')
  }

  copyClip(): boolean {
    const clip = this.clip(this.selectedClip)
    if (!clip) return false
    this.clipboard = structuredClone(clip)
    return true
  }

  // paste at the playhead (floored to the beat) on the source/armed track
  pasteClip(): Clip | null {
    if (!this.clipboard) return null
    const trackId = this.selectedClip?.trackId ?? this.armedTrackId
    const track = trackId ? this.track(trackId) : undefined
    if (!track) return null
    this.checkpoint('paste clip')
    const clip = structuredClone(this.clipboard)
    clip.id = newId()
    clip.start = Math.max(0, Math.floor(this.transport.positionBeat()))
    track.clips.push(clip)
    this.selectClip(track.id, clip.id)
    this.emit('clips')
    return clip
  }

  duplicateClip(trackId: string, clipId: string): Clip | null {
    const track = this.track(trackId)
    const clip = track?.clips.find(c => c.id === clipId)
    if (!track || !clip) return null
    this.checkpoint('duplicate clip')
    const copy = structuredClone(clip)
    copy.id = newId()
    copy.start = clip.start + clip.length
    track.clips.push(copy)
    this.selectClip(trackId, copy.id)
    this.emit('clips')
    return copy
  }

  // split at an absolute timeline beat; returns the new right-hand clip
  splitClip(trackId: string, clipId: string, atBeat: number): Clip | null {
    const track = this.track(trackId)
    const clip = track?.clips.find(c => c.id === clipId)
    if (!track || !clip) return null
    const rel = atBeat - clip.start
    if (rel <= 0 || rel >= clip.length) return null
    this.checkpoint('split clip')
    const right: Clip = {
      id: newId(),
      start: clip.start + rel,
      length: clip.length - rel,
      notes: clip.notes
        .filter(n => n.start >= rel)
        .map(n => ({ ...n, start: n.start - rel })),
    }
    if (clip.audio) {
      right.audio = { ...clip.audio, offsetSec: clip.audio.offsetSec + rel * (60 / this.project.bpm) }
    }
    clip.notes = clip.notes
      .filter(n => n.start < rel)
      .map(n => ({ ...n, dur: Math.min(n.dur, rel - n.start) }))
    clip.length = rel
    track.clips.push(right)
    this.selectClip(trackId, right.id)
    this.emit('clips')
    return right
  }

  quantizeClip(trackId: string, clipId: string, grid: number): void {
    const clip = this.track(trackId)?.clips.find(c => c.id === clipId)
    if (!clip || grid <= 0) return
    this.checkpoint('quantize')
    for (const n of clip.notes) {
      n.start = Math.min(clip.length - 1 / 32, Math.round(n.start / grid) * grid)
    }
    this.emit('clips')
  }

  humanizeClip(trackId: string, clipId: string): void {
    const clip = this.track(trackId)?.clips.find(c => c.id === clipId)
    if (!clip) return
    this.checkpoint('humanize')
    for (const n of clip.notes) {
      n.start = Math.max(0, n.start + (Math.random() - 0.5) * 0.06)
      n.vel = Math.min(1, Math.max(0.05, n.vel + (Math.random() - 0.5) * 0.16))
    }
    this.emit('clips')
  }

  transposeClip(trackId: string, clipId: string, semitones: number): void {
    const clip = this.track(trackId)?.clips.find(c => c.id === clipId)
    if (!clip) return
    this.checkpoint('transpose')
    for (const n of clip.notes) {
      n.pitch = Math.min(127, Math.max(0, n.pitch + semitones))
    }
    this.emit('clips')
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
    this.song?.channel(this.armedTrackId)?.setBend(semitones)
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
    this.checkpoint('record take')
    let clip = track.clips.find(c => !c.audio && startBeat >= c.start && startBeat < c.start + c.length)
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
