// Sheet music view: the ABC that abcjs draws as notation. It reuses the YuE2
// exporter, so the notes on screen are exactly what "Download .abc" saves; only
// the display header differs (song title, track name on the staff, bass clef for
// low parts, and no empty second voice).
import { exportAbc } from './abc'
import type { Project, TrackData } from './project'

export interface SheetText {
  text: string
  notes: number
  chords: number
  clef: 'treble' | 'bass'
  messages: string[]
  error?: string
}

const KEY_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
const MINOR_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B']

// "A minor", "E♭ major"; a chromatic song is written in C, so say so
export function keyName(key: Project['key']): string {
  if (key.scale === 'minor') return `${MINOR_NAMES[key.root]} minor`
  if (key.scale === 'major') return `${KEY_NAMES[key.root]} major`
  return 'No key set (written in C)'
}

// text fields in ABC: one line, no quote, comment or escape characters
const plain = (s: string): string => s.replace(/[\r\n"%\\]/g, ' ').replace(/\s+/g, ' ').trim()

function noteTracks(project: Project): TrackData[] {
  return project.tracks.filter(t => t.kind !== 'drums' && t.clips.some(c => c.notes.length))
}

export function notationAbc(project: Project, melodyId: string, chordId?: string | null): SheetText {
  const r = exportAbc(project, melodyId, chordId)
  const track = project.tracks.find(t => t.id === melodyId)
  if (r.error || !track) return { text: '', notes: 0, chords: 0, clef: 'treble', messages: [], error: r.error ?? 'That track has no notes to show.' }
  const pitches = track.clips.flatMap(c => c.notes.map(n => n.pitch)).sort((a, b) => a - b)
  const clef = (pitches[Math.floor(pitches.length / 2)] ?? 60) < 55 ? 'bass' : 'treble'
  const out: string[] = []
  let skipRest = false
  let body = false
  let lastChord = ''
  for (const line of r.text.split('\n')) {
    if (skipRest) { skipRest = false; continue } // the Ins voice's Z rest line
    if (line === 'T:') out.push(`T:${plain(project.name) || 'Untitled'}`)
    else if (line.startsWith('V: Vocal clef=')) out.push(`V: Vocal clef=${clef} name="${plain(track.name)}"`)
    else if (line.startsWith('V: Ins clef=')) continue
    else if (line === 'V: Ins') skipRest = true
    // a lead sheet names a chord when it changes, not each time it is struck again
    else if (body && !line.startsWith('V:')) out.push(line.replace(/"([^"]*)"/g, (all, sym: string) => (sym === lastChord ? '' : ((lastChord = sym), all))))
    else { out.push(line); if (line.startsWith('K:')) body = true }
  }
  return { text: out.join('\n'), notes: r.notes, chords: r.chords, clef, messages: r.messages }
}

// Which tracks to show first: the selected clip's track (or one named like a
// melody), and the first other track that reads cleanly as block chords.
export function defaultParts(project: Project, selectedTrackId?: string | null): { melody: string | null; chords: string | null } {
  const candidates = noteTracks(project)
  const melody = candidates.find(t => t.id === selectedTrackId) ??
    candidates.find(t => /lead|melody|vocal|hook|solo|tune/i.test(t.name)) ?? candidates[0]
  if (!melody) return { melody: null, chords: null }
  const others = candidates.filter(t => t.id !== melody.id)
  const ranked = [...others.filter(t => /chord|pad|key|piano|guitar|stab|organ/i.test(t.name)), ...others.filter(t => !/chord|pad|key|piano|guitar|stab|organ/i.test(t.name))]
  const chords = ranked.find(t => {
    const r = exportAbc(project, melody.id, t.id)
    return !r.error && r.chords > 0 && !r.messages.some(m => m.startsWith('Chords were left out'))
  })
  return { melody: melody.id, chords: chords?.id ?? null }
}
