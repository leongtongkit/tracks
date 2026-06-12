// Offline bounce: rebuild the whole song graph in an OfflineAudioContext,
// schedule every note up front, render, and encode a WAV.

import { encodeWav } from '../record/wav'
import { projectEndBeat, type Project } from './project'
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

  return ctx.startRendering()
}

export async function renderProjectToWav(project: Project): Promise<Blob> {
  const buf = await renderProject(project)
  const left = buf.getChannelData(0)
  const right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : left
  return new Blob([encodeWav(left, right, buf.sampleRate)], { type: 'audio/wav' })
}
