// Central DAW state: the project document, the audio graph, the transport,
// selection/arm state, undo history, and a coarse change bus the UI
// re-renders from.

import { scheduleAutomation } from './automation'
import { History } from './history'
import { MicRecorder } from './mic'
import {
  defaultMixer,
  defaultProject,
  newId,
  newTrack,
  projectEndBeat,
  pruneSamples,
  warpRate,
  type AutoTarget,
  type Clip,
  type KeySig,
  type Project,
  type TrackData,
  type TrackKind,
} from './project'
import { renderProject } from './render'
import { sampleStore } from './samples'
import { settings } from './settings'
import { SongEngine } from './song-engine'
import { Transport } from './transport'

export type DawEvent = 'project' | 'tracks' | 'clips' | 'selection' | 'transport' | 'mixer' | 'arm'

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
        audio: (trackId, region, t, offsetSec, durSec, rate, fadeInSec, fadeOutSec) => this.song?.playClip(trackId, region, t, offsetSec, durSec, rate, fadeInSec, fadeOutSec),
        audioStopAll: at => this.song?.stopAudioClips(at),
        slice: (from, to, beatToTime) => this.scheduleAutomationSlice(from, to, beatToTime),
        discontinuity: at => {
          this.song?.cancelAutomation(at)
          if (!this.transport.playing) this.song?.applyAutomationStatic(this.transport.positionBeat())
        },
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
      this.clickGain.connect(this.ctx.destination)
      this.applyAudioSettings()
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

  // live monitoring levels from settings (exports are unaffected — the
  // offline render builds its own graph at full level)
  applyAudioSettings(): void {
    const t = this.ctx?.currentTime ?? 0
    this.song?.masterGain.gain.setTargetAtTime(0.9 * settings.outputVolume, t, 0.02)
    this.clickGain?.gain.setTargetAtTime(settings.clickVolume, t, 0.02)
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
      if (this.recording) {
        this.recording = false
        this.finishMic()
      }
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
      const names: Record<TrackKind, string> = { synth: 'Synth', drums: 'Drums', sampler: 'Sampler', pads: 'Pads', audio: 'Audio', bus: 'Group' }
      track = newTrack(names[kind], { kind })
    }
    this.project.tracks.push(track)
    this.armedTrackId = track.id // a new track is what you want to play next
    void this.song?.syncTracks(this.project)
    this.emit('tracks', 'arm')
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

  // Freeze: bounce the track (in isolation, with a neutral strip) to a sample,
  // then play that back through the live strip instead of synthesising it —
  // saves CPU on dense projects. Returns false if the track can't be frozen.
  freezing: string | null = null
  async freezeTrack(id: string): Promise<boolean> {
    const track = this.track(id)
    if (!track || track.kind === 'bus' || track.frozen || this.freezing) return false
    this.freezing = id
    this.emit('tracks')
    try {
      const endBeat = projectEndBeat(this.project)
      const clone = structuredClone(track)
      clone.frozen = undefined
      clone.mixer = { ...defaultMixer(), volume: 1, output: 'master' } // neutral: capture the dry tone
      const solo: Project = { ...this.project, tracks: [clone], loop: { on: false, start: 0, end: endBeat } }
      const buf = await renderProject(solo, 44100, { neutralMaster: true })
      const sid = newId()
      const name = `${track.name} (frozen)`
      sampleStore.put(sid, name, buf)
      this.project.samples[sid] = { name, duration: buf.duration }
      this.checkpoint('freeze track')
      track.frozen = { sampleId: sid, lengthBeats: endBeat }
      await this.song?.syncTracks(this.project)
      return true
    } finally {
      this.freezing = null
      this.emit('tracks')
    }
  }

  unfreezeTrack(id: string): void {
    const track = this.track(id)
    if (!track?.frozen) return
    this.checkpoint('unfreeze track')
    const sid = track.frozen.sampleId
    delete track.frozen
    pruneSamples(this.project)
    if (!this.project.samples[sid]) void sampleStore.remove(sid)
    void this.song?.syncTracks(this.project)
    this.emit('tracks')
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
    // write mode records the move into automation at the playhead
    const captured = this.writeAutomation(id, patch)
    Object.assign(track.mixer, patch)
    this.song?.applyMixers(this.project)
    if (captured) this.emit('clips', 'mixer') // clips event redraws lanes
    else this.emit('mixer')
  }

  armTrack(id: string): void {
    this.armedTrackId = id
    this.emit('tracks', 'arm')
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
      const rate = warpRate(clip.audio, this.project.bpm)
      right.audio = { ...clip.audio, offsetSec: clip.audio.offsetSec + rel * (60 / this.project.bpm) * rate }
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

  // double the clip and tile its notes into the new half
  repeatClip(trackId: string, clipId: string): void {
    const clip = this.track(trackId)?.clips.find(c => c.id === clipId)
    if (!clip || clip.audio) return
    this.checkpoint('repeat clip')
    const len = clip.length
    clip.notes.push(...clip.notes.map(n => ({ ...n, start: n.start + len })))
    clip.length = len * 2
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

  // ---------- automation ----------

  automationWrite = false

  toggleAutomationWrite(): void {
    this.automationWrite = !this.automationWrite
    this.emit('transport')
  }

  // call after editing automation points: re-sync the engine so newly-empty
  // targets fall back to their static mixer value and the cursor reflects edits.
  automationEdited(): void {
    this.song?.applyMixers(this.project)
    if (this.song && !this.transport.playing) this.song.applyAutomationStatic(this.transport.positionBeat())
    this.emit('clips')
  }

  // book every track's automated params over the pump slice
  private scheduleAutomationSlice(from: number, to: number, beatToTime: (beat: number) => number): void {
    const song = this.song
    if (!song) return
    for (const track of this.project.tracks) {
      for (const target of Object.keys(track.auto) as AutoTarget[]) {
        const points = track.auto[target]
        const param = song.automationParam(track.id, target)
        if (!points || points.length === 0 || !param) continue
        scheduleAutomation(param, points, from, to, beatToTime, param.value)
      }
    }
  }

  // write mode: when a mixer param maps to an automation target, recording, and
  // the transport is rolling, drop a breakpoint at the playhead. Returns true
  // if the change was captured as automation.
  private writeAutomation(trackId: string, patch: Partial<TrackData['mixer']>): boolean {
    if (!this.automationWrite || !this.transport.playing) return false
    const track = this.track(trackId)
    if (!track) return false
    const beat = this.transport.positionBeat()
    let wrote = false
    const put = (target: AutoTarget, value: number): void => {
      const list = (track.auto[target] ??= [])
      // replace a point within a 16th of the playhead, else insert sorted
      const near = list.find(p => Math.abs(p.beat - beat) < 0.06)
      if (near) near.value = value
      else {
        list.push({ beat, value })
        list.sort((a, b) => a.beat - b.beat)
      }
      wrote = true
    }
    if (patch.volume !== undefined) put('volume', patch.volume)
    if (patch.pan !== undefined) put('pan', patch.pan)
    if (patch.sendA !== undefined) put('sendA', patch.sendA)
    if (patch.sendB !== undefined) put('sendB', patch.sendB)
    if (patch.eq) {
      if (patch.eq[0]?.gain !== undefined) put('eqLow', patch.eq[0].gain)
      if (patch.eq[1]?.gain !== undefined) put('eqMid', patch.eq[1].gain)
      if (patch.eq[2]?.gain !== undefined) put('eqHigh', patch.eq[2].gain)
    }
    return wrote
  }

  // ---------- audio recording / import ----------

  private mic: MicRecorder | null = null
  private micStartBeat = 0
  micError: string | null = null
  countingIn = false
  private countInTimer: ReturnType<typeof setTimeout> | null = null

  toggleRecord(): void {
    this.recording = !this.recording
    if (this.recording) {
      if (this.transport.playing) {
        if (this.track(this.armedTrackId ?? '')?.kind === 'audio') void this.startMic()
      } else if (settings.countInBars > 0) {
        this.startWithCountIn()
      } else {
        this.transport.start()
        if (this.track(this.armedTrackId ?? '')?.kind === 'audio') void this.startMic()
      }
    } else {
      if (this.countInTimer !== null) {
        clearTimeout(this.countInTimer)
        this.countInTimer = null
        this.countingIn = false
      }
      this.finishMic()
    }
    this.emit('transport')
  }

  // a bar or two of metronome before recording starts
  private startWithCountIn(): void {
    this.ensureAudio()
    const ctx = this.audioCtx()
    if (!ctx) return
    const beats = settings.countInBars * 4
    const spb = 60 / this.project.bpm
    const t0 = ctx.currentTime + 0.08
    for (let i = 0; i < beats; i++) this.click(t0 + i * spb, i % 4 === 0)
    this.countingIn = true
    this.countInTimer = setTimeout(() => {
      this.countInTimer = null
      this.countingIn = false
      if (this.recording) {
        // the user may have hit play themselves during the count-in
        if (!this.transport.playing) this.transport.start()
        if (this.track(this.armedTrackId ?? '')?.kind === 'audio') void this.startMic()
        this.emit('transport')
      }
    }, (beats * spb - 0.02) * 1000)
  }

  private async startMic(): Promise<void> {
    if (this.mic?.recording) return
    this.ensureAudio()
    const ctx = this.audioCtx()
    if (!ctx) return
    this.mic = new MicRecorder()
    this.micError = null
    try {
      await this.mic.start(ctx, settings.micProcessing)
      this.micStartBeat = this.transport.positionBeat()
    } catch {
      this.micError = 'Microphone unavailable or denied.'
      this.mic = null
      this.emit('transport')
    }
  }

  // turn whatever the mic captured into an audio clip on the armed track
  private finishMic(): void {
    const buffer = this.mic?.stop() ?? null
    this.mic = null
    if (!buffer || buffer.duration < 0.1) return
    const track = this.track(this.armedTrackId ?? '')
    if (!track || track.kind !== 'audio') return
    this.checkpoint('record audio')
    const n = Object.keys(this.project.samples).length + 1
    const id = newId()
    sampleStore.put(id, `Recording ${n}`, buffer)
    this.project.samples[id] = { name: `Recording ${n}`, duration: buffer.duration }
    const spb = 60 / this.project.bpm
    const clip: Clip = {
      id: newId(),
      start: Math.max(0, this.micStartBeat),
      length: Math.max(0.25, buffer.duration / spb),
      notes: [],
      audio: { sampleId: id, offsetSec: 0, gain: 1, warp: 'off', origBpm: this.project.bpm, fadeIn: 0, fadeOut: 0 },
    }
    track.clips.push(clip)
    this.selectClip(track.id, clip.id)
    this.emit('clips')
  }

  // decode any audio file into the sample store; callers register the project
  // metadata AFTER their checkpoint so undo snapshots stay clean
  async decodeAudioFile(file: File): Promise<{ id: string; buffer: AudioBuffer }> {
    this.ensureAudio()
    const ctx = this.audioCtx()
    if (!ctx) throw new Error('no audio context')
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
    const id = newId()
    sampleStore.put(id, file.name, buffer)
    return { id, buffer }
  }

  private registerSample(id: string, name: string, buffer: AudioBuffer): void {
    this.project.samples[id] = { name, duration: buffer.duration }
  }

  // load an uploaded file as the sampler's sample
  async loadSamplerFile(trackId: string, file: File): Promise<void> {
    const track = this.track(trackId)
    if (!track) return
    const { id, buffer } = await this.decodeAudioFile(file)
    this.checkpoint('load sample')
    this.registerSample(id, file.name, buffer)
    track.sampler.sampleId = id
    this.emit('tracks')
  }

  // load an uploaded file onto one pad (padIndex 0..15)
  async loadPadFile(trackId: string, padIndex: number, file: File): Promise<void> {
    const track = this.track(trackId)
    const pad = track?.pads.pads[padIndex]
    if (!pad) return
    const { id, buffer } = await this.decodeAudioFile(file)
    this.checkpoint('load pad')
    this.registerSample(id, file.name, buffer)
    pad.sampleId = id
    this.emit('tracks')
  }

  // shared by the file picker and lane drag-drop
  async importAudioFile(file: File, trackId: string, atBeat: number): Promise<Clip | null> {
    const track = this.track(trackId)
    if (!track) return null
    const { id, buffer } = await this.decodeAudioFile(file)
    this.checkpoint('import audio')
    this.registerSample(id, file.name, buffer)
    const spb = 60 / this.project.bpm
    const clip: Clip = {
      id: newId(),
      start: Math.max(0, atBeat),
      length: Math.max(0.25, buffer.duration / spb),
      notes: [],
      audio: { sampleId: id, offsetSec: 0, gain: 1, warp: 'off', origBpm: this.project.bpm, fadeIn: 0, fadeOut: 0 },
    }
    track.clips.push(clip)
    this.selectClip(trackId, clip.id)
    this.emit('clips')
    return clip
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
