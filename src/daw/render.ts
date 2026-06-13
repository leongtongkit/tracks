// Offline bounce: rebuild the whole song graph in an OfflineAudioContext,
// schedule every note up front, render, and encode a WAV.

import { encodeWav } from '../record/wav'
import { scheduleAutomation } from './automation'
import { projectEndBeat, TempoMap, warpRate, type AutoTarget, type Project } from './project'
import { SongEngine } from './song-engine'
import { collectEvents, scheduledAudioClips } from './transport'

const TAIL_S = 2.5 // let releases/delays/reverbs ring out

export async function renderProject(project: Project, sampleRate = 44100, opts: { neutralMaster?: boolean } = {}): Promise<AudioBuffer> {
  const map = new TempoMap(project.bpm, project.tempoMap)
  const endBeat = projectEndBeat(project)
  const duration = map.secAtBeat(endBeat) + TAIL_S
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate)

  const song = new SongEngine(ctx, undefined, undefined, opts)
  await song.syncTracks(project)

  const startAt = 0.05
  const at = (beat: number): number => startAt + map.secAtBeat(beat)
  const wall = (b0: number, b1: number): number => map.secAtBeat(b1) - map.secAtBeat(b0)
  for (const ev of collectEvents(project.tracks, 0, endBeat)) {
    const tOn = at(ev.startBeat)
    song.noteOn(ev.trackId, ev.pitch, ev.vel, tOn)
    song.noteOff(ev.trackId, ev.pitch, Math.max(tOn + 0.02, at(ev.startBeat + ev.durBeats) - 0.01))
  }
  for (const track of project.tracks) {
    for (const clip of scheduledAudioClips(track)) {
      if (!clip.audio) continue
      const rate = warpRate(clip.audio, project.bpm)
      const end = clip.start + clip.length
      song.playClip(
        track.id,
        clip.audio,
        at(clip.start),
        clip.audio.offsetSec,
        wall(clip.start, end) * rate,
        rate,
        wall(clip.start, clip.start + clip.audio.fadeIn),
        wall(end - clip.audio.fadeOut, end),
      )
    }
  }
  // automation curves, booked over the whole song in one pass
  const beatToTime = (beat: number): number => at(beat)
  for (const track of project.tracks) {
    for (const target of Object.keys(track.auto) as AutoTarget[]) {
      const points = track.auto[target]
      const param = song.automationParam(track.id, target)
      if (!points || points.length === 0 || !param) continue
      scheduleAutomation(param, points, 0, endBeat, beatToTime, param.value)
    }
  }

  return ctx.startRendering()
}

export async function renderProjectToWav(project: Project, sampleRate = 44100): Promise<Blob> {
  const buf = await renderProject(project, sampleRate)
  const left = buf.getChannelData(0)
  const right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : left
  return new Blob([encodeWav(left, right, buf.sampleRate)], { type: 'audio/wav' })
}
