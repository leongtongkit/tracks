// A MIDI file as a YuE2 score. YuE2 song pages hand out a song's score as MIDI with
// two parts named Vocal Melody and Ins Melody, so a part whose name has "Vocal" goes
// to V: Vocal and one whose name has "Ins" to V: Ins; the other melodic parts fill
// whichever is left, in file order. Drums are left out. Notes snap to YuE2's
// sixteenth-note grid, one note at a time per part (the top one where they overlap).
// Tempo, time signature and key come from the file.

import { writeYueAbc, type GridNote } from '../daw/abc'
import { importMidi } from '../daw/midi'
import { projectEndBeat, type Project, type TrackData as Track } from '../daw/project'
import { collectEvents } from '../daw/transport'

const GRID = 4 // steps per quarter note: L:1/16

export interface MidiScore {
  text: string
  /** the MIDI part each voice came from, or null when nothing went there */
  from: { Vocal: string | null; Ins: string | null }
  /** what the visitor should know, in plain words */
  messages: string[]
}

export function midiToScore(bytes: Uint8Array): MidiScore | { error: string } {
  let project: Project
  try {
    project = importMidi(bytes)
  } catch (e) {
    const why = e instanceof Error ? e.message : ''
    if (why.startsWith('no notes')) return { error: 'That MIDI file has no notes in it.' }
    if (why.startsWith('SMPTE')) return { error: "That MIDI file counts time in video frames instead of beats, so it can't become sheet music." }
    return { error: "That file isn't a MIDI file Tracks can read." }
  }
  const melodic = project.tracks.filter(t => t.kind !== 'drums')
  if (!melodic.length) return { error: 'That MIDI file only has drums. Sheet music needs a melody, so there is nothing to show.' }

  let vocal = melodic.find(t => /vocal/i.test(t.name))
  let ins = melodic.find(t => t !== vocal && /\bins/i.test(t.name))
  const others = melodic.filter(t => t !== vocal && t !== ins)
  vocal ??= others.shift()
  ins ??= others.shift()

  let moved = false
  let overlapped = false
  const end = projectEndBeat(project)
  const part = (track: Track | undefined): GridNote[] => {
    if (!track) return []
    const notes = collectEvents([track], 0, end).map(e => {
      const a = e.startBeat * GRID, b = (e.startBeat + e.durBeats) * GRID
      if (Math.abs(a - Math.round(a)) > 1e-6 || Math.abs(b - Math.round(b)) > 1e-6) moved = true
      const start = Math.round(a)
      return { start, end: Math.max(start + 1, Math.round(b)), pitch: e.pitch }
    })
    notes.sort((x, y) => x.start - y.start || y.pitch - x.pitch)
    const mono: GridNote[] = []
    for (const n of notes) {
      const last = mono[mono.length - 1]
      if (last && n.start < last.end) {
        overlapped = true
        if (n.pitch <= last.pitch) continue
        last.end = n.start
        if (last.end <= last.start) mono.pop()
      }
      mono.push(n)
    }
    return mono
  }
  const vocalNotes = part(vocal), insNotes = part(ins)

  let text: string
  try {
    text = writeYueAbc({ timeSig: project.timeSig, bpm: project.bpm, key: project.key, grid: GRID, vocal: vocalNotes, ins: insNotes, chords: [] })
  } catch {
    return { error: `YuE2 can't use that MIDI file's time signature (${project.timeSig.num}/${project.timeSig.den}).` }
  }

  const quote = (t: Track): string => `“${t.name}”`
  const messages = [
    vocal ? `Vocal part from ${quote(vocal)}.` : 'The Vocal part is empty: the file has no part for it.',
    ins ? `Ins part from ${quote(ins)}.` : 'The Ins part is empty.',
  ]
  const left = project.tracks.filter(t => t !== vocal && t !== ins)
  if (left.length) messages.push(`Left out: ${left.map(quote).join(', ')}.`)
  if (moved) messages.push('Some notes were moved to the nearest sixteenth note.')
  if (overlapped) messages.push('Where notes overlapped, the top note was kept.')
  if (project.key.scale === 'chromatic') messages.push('The file has no key, so the score is in C major.')
  return { text, from: { Vocal: vocal?.name ?? null, Ins: ins?.name ?? null }, messages }
}
