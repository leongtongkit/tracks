// Offline bounce: rebuild the whole song graph in an OfflineAudioContext,
// schedule every note up front, render, and encode a WAV.

import { encodeWav } from '../record/wav'
import { scheduleAutomation } from './automation'
import { projectEndBeat, warpRate, type AutoTarget, type Project } from './project'
import { SongEngine } from './song-engine'
import { collectEvents } from './transport'

const TAIL_S = 2.5 // let releases/delays/reverbs ring out

export async function renderProject(project: Project, sampleRate = 44100): Promise<AudioBuffer> {
  const spb = 60 / project.bpm
  const endBeat = projectEndBeat(project)
  const duration = endBeat * spb + TAIL_S
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate)

  const song = new SongEngine(ctx)
  await song.syncTracks(project)

  const startAt = 0.05
  for (const ev of collectEvents(project.tracks, 0, endBeat)) {
    const tOn = startAt + ev.startBeat * spb
    song.noteOn(ev.trackId, ev.pitch, ev.vel, tOn)
    song.noteOff(ev.trackId, ev.pitch, tOn + Math.max(0.02, ev.durBeats * spb - 0.01))
  }
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (!clip.audio) continue
      const rate = warpRate(clip.audio, project.bpm)
      song.playClip(track.id, clip.audio, startAt + clip.start * spb, clip.audio.offsetSec, clip.length * spb * rate, rate, clip.audio.fadeIn * spb, clip.audio.fadeOut * spb)
    }
  }
  // automation curves, booked over the whole song in one pass
  const beatToTime = (beat: number): number => startAt + beat * spb
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
