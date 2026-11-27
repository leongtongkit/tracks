// YuE2's score format: the two-voice ABC that YuE2 reads and writes.
//
// check() applies the rules of YuE2's own score checker (abc_tools.py in the
// YuE repository, Apache-2.0; a copy is in e2e/yue2/ for the tests) and says
// what is wrong in plain words, with where it is in the text.
// edit() makes one change through the text (a note up a step, a new length,
// a rest, a chord symbol, a bar...) so that every bar stays the way YuE2
// needs it, and leaves everything it did not touch exactly as it was.

export const VOICES = ['Vocal', 'Ins'] as const
export type VoiceName = (typeof VOICES)[number]
/** Note lengths YuE2 reads, in L: units. Other lengths are tied notes. */
export const DURATIONS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48] as const
const ALLOWED = new Set<number>(DURATIONS)
const LONGEST_FIRST = [...DURATIONS].reverse()
export const QUALITIES = ['', 'm', 'dim', 'aug', '7', 'maj7', 'm7', 'dim7', 'm7b5', 'sus4', 'sus2', '6', 'm6', '7sus4', 'm(maj7)']
const PITCH_NAME = '[A-G](?:bb|##|b|#)?'
const CHORD = new RegExp(`^${PITCH_NAME}(?:${QUALITIES.map(q => q.replace(/[()]/g, '\\$&')).join('|')})(?:/${PITCH_NAME})?$`)
const TOKEN = /"([^"\n]*)"|\[K:([^\]\n]+)\]|(\^\^|__|\^|_|=)?([A-Ga-gz])([,']*)([0-9]*)(-?)/y
const NATURAL: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const LETTERS = 'CDEFGAB'
export const MAJOR_KEYS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
export const MINOR_KEYS = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m']
const KEYS = new Map<string, number>([...MAJOR_KEYS.map((k, i) => [k, i - 7] as const), ...MINOR_KEYS.map((k, i) => [k, i - 7] as const)])
export const VOICE_LINES = ['V: Vocal clef=treble name="Vocal Melody" snm="Vocal"', 'V: Ins clef=treble name="Ins Melody" snm="Inst."']
const ALT: Record<string, number> = { '=': 0, _: -1, __: -2, '^': 1, '^^': 2 }
const ACC = ['__', '_', '=', '^', '^^'] // by alteration + 2
const WHOLE = 1024 // ticks in a whole note: every YuE2 length is a whole number of them
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/g // the line ends Python's splitlines() knows

export interface Problem { message: string; start: number; end: number }
export interface Tok {
  kind: 'chord' | 'key' | 'note' | 'rest'
  start: number
  end: number
  text: string
  /** ticks from the start of the bar */
  onset: number
  /** chord symbol or key */
  value?: string
  units?: number
  acc?: string
  letter?: string
  /** the written note's pitch without accidentals (MIDI) */
  written?: number
  /** sounding pitch (MIDI) */
  pitch?: number
  tie?: boolean
}
export interface Bar {
  voice: VoiceName
  index: number
  group: number
  line: number
  seg: number
  /** the bar's text; for a Z run, the whole run */
  start: number
  end: number
  z: boolean
  meter: [number, number]
  ticks: number
  /** ticks from the start of the score */
  time: number
  key: string
  toks: Tok[]
}
interface Seg { start: number; text: string; bars: number[] }
interface MusicLine { line: number; voice: VoiceName; group: number; segs: Seg[] }
interface Line { text: string; start: number; sep: string }
export interface SoundingNote { onset: number; pitch: number; dur: number }
export interface Score {
  text: string
  problems: Problem[]
  /** L:1/unit */
  unit: number
  bpm: number
  meter: [number, number]
  key: string
  bars: Record<VoiceName, Bar[]>
  /** sounding notes with ties joined, in ticks, as YuE2's checker counts them */
  notes: Record<VoiceName, SoundingNote[]>
  chords: { time: number; symbol: string }[]
  lines: Line[]
  music: MusicLine[]
}

const pow2 = (d: number): boolean => d <= 1024 && (d & (d - 1)) === 0
function keyAcc(key: string): Record<string, number> {
  const count = KEYS.get(key) ?? 0
  const result: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 }
  for (const l of (count > 0 ? 'FCGDAEB' : 'BEADGCF').slice(0, Math.abs(count))) result[l] = count > 0 ? 1 : -1
  return result
}
function meterOf(s: string): [number, number] | null {
  const m = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(s)
  return m ? [Number(m[1]), Number(m[2])] : null
}
export const isKey = (key: string): boolean => KEYS.has(key)
export const isChord = (symbol: string): boolean => CHORD.test(symbol)
/** quarter-note beats, as a person would say them: 4, 3½, 2¼ */
function beats(ticks: number): string {
  const q = ticks / 256, whole = Math.floor(q), frac = q - whole
  const f = frac === 0.5 ? '½' : frac === 0.25 ? '¼' : frac === 0.75 ? '¾' : ''
  if (frac && !f) return String(Math.round(q * 1000) / 1000)
  return (whole || !f ? String(whole) : '') + f
}
const plural = (ticks: number): string => `${beats(ticks)} ${ticks === 256 ? 'beat' : 'beats'}`

function splitLines(text: string): Line[] {
  const lines: Line[] = []
  let at = 0
  for (const m of text.matchAll(LINE_BREAK)) {
    lines.push({ text: text.slice(at, m.index), start: at, sep: m[0] })
    at = m.index + m[0].length
  }
  if (at < text.length) lines.push({ text: text.slice(at), start: at, sep: '' })
  return lines
}

interface VoiceState { meter: [number, number]; key: string; time: number; pending: { pitch: number; written: number } | null; keys: string[]; grid: string[]; lastNote: Tok | null }

/** Check a score against YuE2's rules. No problems means YuE2's own checker accepts it. */
export function check(text: string): Score {
  const lines = splitLines(text)
  const s: Score = { text, problems: [], unit: 16, bpm: 0, meter: [4, 4], key: 'C', bars: { Vocal: [], Ins: [] }, notes: { Vocal: [], Ins: [] }, chords: [], lines, music: [] }
  const problem = (message: string, start: number, end: number): void => { s.problems.push({ message, start, end }) }
  const onLine = (i: number, message: string): void => {
    const l = lines[i]
    if (l) problem(message, l.start, l.start + l.text.length); else problem(message, text.length, text.length)
  }
  if (lines.length < 12) {
    problem('A YuE2 score needs its 8 header lines (X:, T:, M:, L:, Q:, the two V: lines and K:), then at least one Vocal line and one Ins line.', 0, text.length)
    return s
  }
  // the header, line by line, as YuE2 writes it
  if (lines[0].text !== 'X:1' || lines[1].text !== 'T:') onLine(lines[0].text !== 'X:1' ? 0 : 1, 'The score must start with the lines X:1 and T: (YuE2 leaves the title empty).')
  let fatal = false
  const meter = lines[2].text.startsWith('M:') ? meterOf(lines[2].text.slice(2)) : null
  if (!lines[2].text.startsWith('M:')) { onLine(2, 'Line 3 must be the time signature, like M:4/4.'); fatal = true }
  else if (!meter) { onLine(2, `YuE2 can't read the time signature “${lines[2].text}”. Write it as a fraction, like M:4/4 or M:6/8.`); fatal = true }
  else if (!pow2(meter[1])) { onLine(2, 'The bottom number of the time signature must be 1, 2, 4, 8, 16 or another power of two.'); fatal = true }
  const unitMatch = /^L:1\/([1-9][0-9]*)$/.exec(lines[3].text)
  if (!unitMatch) { onLine(3, 'Line 4 must be the note length, like L:1/16.'); fatal = true }
  else if (!pow2(Number(unitMatch[1]))) { onLine(3, 'The note length must be 1/16, 1/32 or another power of two.'); fatal = true }
  const tempo = /^Q:1\/4=([1-9][0-9]*)$/.exec(lines[4].text)
  if (!tempo) onLine(4, 'Line 5 must be the tempo in beats per minute, like Q:1/4=88.')
  if (lines[5].text !== VOICE_LINES[0] || lines[6].text !== VOICE_LINES[1]) onLine(lines[5].text !== VOICE_LINES[0] ? 5 : 6, `Lines 6 and 7 must be YuE2's two voice lines, exactly: ${VOICE_LINES[0]} and ${VOICE_LINES[1]}`)
  const key = lines[7].text.slice(2)
  if (!lines[7].text.startsWith('K:')) { onLine(7, 'Line 8 must be the key, like K:C or K:Am.'); fatal = true }
  else if (!KEYS.has(key)) { onLine(7, `YuE2 doesn't know the key “${key}”. Use a major key like C, G or Bb, or a minor key like Am or F#m.`); fatal = true }
  if (fatal) return s
  s.meter = meter!
  s.unit = Number(unitMatch![1])
  s.bpm = tempo ? Number(tempo[1]) : 0
  s.key = key
  const perUnit = WHOLE / s.unit
  const voices: Record<VoiceName, VoiceState> = {
    Vocal: { meter: s.meter, key, time: 0, pending: null, keys: [`0:${key}`], grid: [], lastNote: null },
    Ins: { meter: s.meter, key, time: 0, pending: null, keys: [`0:${key}`], grid: [], lastNote: null },
  }
  let skipGrid = false // a bar count or line problem makes the grid comparison meaningless
  let stopped = false
  let cursor = 8
  let group = 0
  while (cursor < lines.length) {
    while (cursor < lines.length && lines[cursor].text.startsWith('% ')) cursor++
    if (cursor === lines.length) { onLine(cursor - 1, `The comment on line ${cursor} has no music after it.`); break }
    group++
    const counts: number[] = []
    let firstBar = 0
    for (const name of VOICES) {
      const voice = voices[name]
      const here = lines[cursor]?.text
      if (here !== `V: ${name}`) {
        onLine(cursor, here === undefined ? `The score ends where the ${name} part's V: ${name} line should be.`
          : here === '' ? `Line ${cursor + 1} is empty. YuE2 doesn't allow empty lines in a score.`
          : `Line ${cursor + 1} should be “V: ${name}”. Each section is a V: Vocal line and its music, then a V: Ins line and its music.`)
        stopped = true
        break
      }
      cursor++
      const fields = new Set<string>()
      while (cursor < lines.length && /^[MK]:/.test(lines[cursor].text)) {
        const field = lines[cursor].text[0], value = lines[cursor].text.slice(2)
        if (fields.has(field)) onLine(cursor, `Line ${cursor + 1} repeats the ${field}: change for the ${name} part.`)
        fields.add(field)
        if (field === 'M') {
          const m = meterOf(value)
          if (!m || !pow2(m[1])) onLine(cursor, `YuE2 can't read the time signature “${lines[cursor].text}”. Write it as a fraction, like M:3/4.`)
          else voice.meter = m
        } else if (!KEYS.has(value)) onLine(cursor, `YuE2 doesn't know the key “${value}”. Use a major key like C, G or Bb, or a minor key like Am or F#m.`)
        else { voice.key = value; voice.keys.push(`${voice.time}:${value}`) }
        cursor++
      }
      if (cursor >= lines.length) { onLine(cursor - 1, `The ${name} part's music line is missing at the end of the score.`); stopped = true; break }
      const lineIndex = cursor
      const line = lines[cursor]
      cursor++
      if (!line.text.endsWith('|')) { onLine(lineIndex, `Line ${lineIndex + 1} (${name}) must end with a barline |.`); counts.push(-1); skipGrid = true; continue }
      const music: MusicLine = { line: lineIndex, voice: name, group: group - 1, segs: [] }
      const pieces: { body: string; start: number; z: boolean; seg: number }[] = []
      let pos = line.start
      let empty = false
      for (const raw of line.text.slice(0, -1).split('|')) {
        const seg: Seg = { start: pos, text: raw, bars: [] }
        music.segs.push(seg)
        const body = raw.trim()
        const start = pos + raw.length - raw.trimStart().length
        pos += raw.length + 1
        if (!body) { empty = true; continue }
        const z = /^Z([2-4])?$/.exec(body)
        if (z) for (let k = 0; k < Number(z[1] ?? 1); k++) pieces.push({ body: 'Z', start, z: true, seg: music.segs.length - 1 })
        else pieces.push({ body, start, z: false, seg: music.segs.length - 1 })
      }
      if (empty) { onLine(lineIndex, `Line ${lineIndex + 1} (${name}) has an empty bar or a double barline. YuE2 uses single | barlines only.`); counts.push(-1); skipGrid = true; continue }
      if (pieces.length < 1 || pieces.length > 4) onLine(lineIndex, `Line ${lineIndex + 1} (${name}) has ${pieces.length} bars. YuE2 puts 1 to 4 bars on a line.`)
      if (name === 'Vocal') firstBar = s.bars.Vocal.length
      counts.push(pieces.length)
      s.music.push(music)
      for (const piece of pieces) {
        const bar = parseBar(s, voice, name, piece.body, piece.start, perUnit, problem)
        bar.group = group - 1
        bar.line = lineIndex
        bar.seg = piece.seg
        if (piece.z) bar.end = piece.start + music.segs[piece.seg].text.trim().length
        music.segs[piece.seg].bars.push(bar.index)
      }
    }
    if (stopped) break
    if (counts.length === 2 && counts[0] >= 0 && counts[1] >= 0 && counts[0] !== counts[1]) {
      skipGrid = true
      const short: VoiceName = counts[0] < counts[1] ? 'Vocal' : 'Ins'
      const from = firstBar + Math.min(...counts) + 1, to = firstBar + Math.max(...counts)
      const where = s.music[s.music.length - (short === 'Vocal' ? 2 : 1)].line
      onLine(where, `The ${short} part is missing ${from === to ? `bar ${from}` : `bars ${from} to ${to}`}: the Vocal and Ins lines of a section need the same number of bars.`)
    }
  }
  if (!stopped) {
    for (const name of VOICES) {
      const v = voices[name]
      if (v.pending && v.lastNote) problem(`The last note of the ${name} part is tied to nothing. Remove the - after it.`, v.lastNote.start, v.lastNote.end)
    }
    const insChord = s.bars.Ins.flatMap(b => b.toks).find(t => t.kind === 'chord')
    if (insChord) problem('Chord symbols belong in the Vocal part, not Ins.', insChord.start, insChord.end)
    if (!skipGrid) {
      const a = voices.Vocal.grid, b = voices.Ins.grid
      const at = a.findIndex((g, i) => g !== b[i])
      if (at >= 0 || a.length !== b.length) {
        const bar = s.bars.Vocal[at >= 0 ? at : Math.min(a.length, b.length) - 1]
        problem('The Vocal and Ins parts change time signature in different places. Put the same M: change in both.', bar?.start ?? 0, bar?.end ?? 0)
      }
      if (voices.Vocal.keys.join() !== voices.Ins.keys.join()) problem('The Vocal and Ins parts change key in different places. Put the same K: change in both.', lines[7].start, lines[7].start + lines[7].text.length)
    }
  }
  return s
}

function parseBar(s: Score, voice: VoiceState, name: VoiceName, body: string, base: number, perUnit: number, problem: (m: string, a: number, b: number) => void): Bar {
  const bars = s.bars[name]
  const [n, d] = voice.meter
  const length = (n * WHOLE) / d
  const bar: Bar = { voice: name, index: bars.length, group: 0, line: 0, seg: 0, start: base, end: base + body.length, z: body === 'Z', meter: voice.meter, ticks: length, time: voice.time, key: voice.key, toks: [] }
  bars.push(bar)
  const where = `Bar ${bar.index + 1} of the ${name} part`
  const meterText = `${n}/${d}`
  let offset = 0
  let failed = false
  let local: Record<string, number> = {}
  if (bar.z) {
    if (voice.pending) { problem(`${where} is a whole-bar rest, but the note before it is tied into it. Remove that tie.`, base, base + 1); failed = true }
    offset = length
  } else {
    let c = 0
    while (c < body.length) {
      if (/\s/.test(body[c])) { c++; continue }
      TOKEN.lastIndex = c
      const m = TOKEN.exec(body)
      if (!m) { problem(`${where} has something YuE2 can't read: “${body.slice(c, c + 12)}”.`, base + c, base + Math.min(body.length, c + 12)); failed = true; break }
      const start = base + c, end = base + TOKEN.lastIndex
      c = TOKEN.lastIndex
      if (offset >= length) {
        if (m[1] !== undefined || m[2] !== undefined) problem(`${where} has ${m[1] !== undefined ? 'a chord symbol' : 'a key change'} after its last note. Move “${m[0]}” in front of a note.`, start, end)
        else problem(`${where} is longer than ${meterText} (it adds up to ${plural(offset + barTotal(body.slice(start - base), perUnit))}; the bar holds ${beats(length)}).`, bar.start, bar.end)
        failed = true
        break
      }
      const [whole, chord, key, acc, note, octave, digits, tie] = m
      if (chord !== undefined) {
        if (!CHORD.test(chord)) problem(`YuE2 doesn't know the chord “${chord}” (${where.toLowerCase()}). It knows chords like C, Cm, C7, Cmaj7, Cm7, Cdim, Caug, Csus4, C6 and C/E.`, start, end)
        else if (name === 'Vocal') s.chords.push({ time: voice.time + offset, symbol: chord })
        bar.toks.push({ kind: 'chord', start, end, text: whole, onset: offset, value: chord })
        continue
      }
      if (key !== undefined) {
        if (!KEYS.has(key)) problem(`YuE2 doesn't know the key “${key}” (${where.toLowerCase()}). Use a major key like C, G or Bb, or a minor key like Am or F#m.`, start, end)
        else { voice.key = key; voice.keys.push(`${voice.time + offset}:${key}`); local = {} }
        bar.toks.push({ kind: 'key', start, end, text: whole, onset: offset, value: key })
        continue
      }
      const units = digits ? parseInt(digits, 10) : 1
      if (!ALLOWED.has(units)) { problem(`${where} has a note YuE2 can't use: “${whole}” is ${units} units long. YuE2 takes lengths 1, 2, 3, 4, 6, 8, 12, 16, 24, 32 and 48; tie notes together for other lengths (like C4-C).`, start, end); failed = true; break }
      const dur = units * perUnit
      if (offset + dur > length) {
        const total = offset + barTotal(body.slice(start - base), perUnit)
        problem(`${where} is longer than ${meterText} (it adds up to ${plural(total)}; the bar holds ${beats(length)}).`, bar.start, bar.end)
        failed = true
        break
      }
      if (octave.includes(',') && octave.includes("'")) { problem(`“${whole}” in ${where.toLowerCase()} mixes , and ' octave marks.`, start, end); failed = true; break }
      if (note === 'z') {
        if (acc || octave || tie) { problem(`A rest can't have a sharp, flat, octave mark or tie: “${whole}” in ${where.toLowerCase()}.`, start, end); failed = true; break }
        if (voice.pending) { problem(`In ${where.toLowerCase()}, a note is tied into a rest. Remove the - after the note before it.`, start, end); failed = true; break }
        bar.toks.push({ kind: 'rest', start, end, text: whole, onset: offset, units })
      } else {
        const letter = note.toUpperCase()
        const written = 60 + NATURAL[letter] + (note !== letter ? 12 : 0) + 12 * ([...octave].filter(x => x === "'").length - [...octave].filter(x => x === ',').length)
        let alteration = local[letter] ?? keyAcc(voice.key)[letter]
        if (acc) { alteration = ALT[acc]; local[letter] = alteration }
        let pitch = written + alteration
        const tok: Tok = { kind: 'note', start, end, text: whole, onset: offset, units, acc: acc || undefined, letter, written, pitch, tie: !!tie }
        if (voice.pending) {
          if (!acc && written === voice.pending.written) pitch = voice.pending.pitch
          if (pitch !== voice.pending.pitch) { problem(`In ${where.toLowerCase()}, a tie joins two different notes. A tie (-) only joins two notes of the same pitch.`, start, end); failed = true; break }
          tok.pitch = pitch
          const notes = s.notes[name]
          notes[notes.length - 1].dur += dur
        } else {
          if (pitch < 0 || pitch > 127) { problem(`“${whole}” in ${where.toLowerCase()} is too ${pitch < 0 ? 'low' : 'high'} to play.`, start, end); failed = true; break }
          s.notes[name].push({ onset: voice.time + offset, pitch, dur })
        }
        voice.pending = tie ? { pitch, written } : null
        voice.lastNote = tok
        bar.toks.push(tok)
      }
      offset += dur
    }
    if (!failed && offset !== length) problem(`${where} is shorter than ${meterText} (it adds up to ${plural(offset)}; the bar needs ${beats(length)}).`, bar.start, bar.end)
  }
  if (failed) voice.pending = null
  voice.grid.push(`${voice.time}:${length}:${n}/${d}`)
  voice.time += length
  return bar
}

/** every note and rest length in a bar's text, added up (for the message only) */
function barTotal(body: string, perUnit: number): number {
  let total = 0
  for (const m of body.matchAll(/[A-Ga-gz][,']*([0-9]*)/g)) total += (m[1] ? parseInt(m[1], 10) : 1) * perUnit
  return total
}

// ---- editing -------------------------------------------------------------

export interface Target { voice: VoiceName; bar: number; item: number; start: number; end: number; tok: Tok | null }

/** The note or rest at a place in the text (a caret, or a click on the score). */
export function locate(score: Score, at: number, end = at): Target | null {
  let best: Target | null = null
  for (const voice of VOICES) {
    for (const bar of score.bars[voice]) {
      if (bar.z) {
        if (at >= bar.start && at < Math.max(bar.end, bar.start + 1) && !best) best = { voice, bar: bar.index, item: -1, start: bar.start, end: bar.end, tok: null }
        continue
      }
      if (at > bar.end || end < bar.start) continue
      const items = bar.toks.filter(t => t.kind === 'note' || t.kind === 'rest')
      // a token inside the range, else the one the caret is in or just after
      let i = items.findIndex(t => t.start >= at && t.end <= end && end > at)
      if (i < 0) i = items.findIndex(t => t.start <= at && at < t.end)
      if (i < 0) {
        const mark = bar.toks.find(t => (t.kind === 'chord' || t.kind === 'key') && t.start <= at && at < t.end)
        if (mark) i = items.findIndex(t => t.onset >= mark.onset)
      }
      if (i < 0) i = items.findIndex(t => t.end === at)
      if (i >= 0) return { voice, bar: bar.index, item: i, start: items[i].start, end: items[i].end, tok: items[i] }
    }
  }
  return best
}

export type Op =
  | { kind: 'step'; dir: 1 | -1 }
  | { kind: 'semitone'; dir: 1 | -1 }
  | { kind: 'octave'; dir: 1 | -1 }
  | { kind: 'length'; units: number }
  | { kind: 'dot' }
  | { kind: 'rest' }
  | { kind: 'delete' }
  | { kind: 'insert' }
  | { kind: 'chord'; symbol: string }
  | { kind: 'bar' }
export type EditResult = { text: string; start: number; end: number } | { error: string }

interface Item { rest: boolean; units: number; pitch: number; letter: string; written: number; tie: boolean; orig?: Tok }
interface Mark { onset: number; chord?: string; key?: string; orig?: Tok }
interface BarModel { bar: Bar; units: number; items: Item[] | null; marks: Mark[] }

/** lengths YuE2 reads that add up to `units`, longest first */
export function fill(units: number): number[] {
  const out: number[] = []
  while (units > 0) { const u = LONGEST_FIRST.find(x => x <= units)!; out.push(u); units -= u }
  return out
}
const restItem = (units: number): Item => ({ rest: true, units, pitch: 0, letter: '', written: 0, tie: false })
const isDotted = (u: number): boolean => u % 3 === 0

function stepSpelling(letter: string, written: number, dir: number): { letter: string; written: number } {
  const i = LETTERS.indexOf(letter) + dir
  const next = LETTERS[(i + 7) % 7]
  return { letter: next, written: written + NATURAL[next] - NATURAL[letter] + (i > 6 ? 12 : i < 0 ? -12 : 0) }
}
/** how to write a pitch in a key: the key's own notes first, then sharps going up and flats going down */
function spell(pitch: number, key: string, dir = 1): { letter: string; written: number } {
  const acc = keyAcc(key)
  let best: { letter: string; written: number; score: number } | null = null
  for (const letter of LETTERS) {
    for (let alter = -1; alter <= 1; alter++) {
      const written = pitch - alter
      if ((((written - 60 - NATURAL[letter]) % 12) + 12) % 12) continue
      const score = (acc[letter] === alter ? 0 : alter === 0 ? 1 : (alter > 0) === (dir > 0) ? 2 : 4) + ('EB'.includes(letter) && alter === 1 || 'CF'.includes(letter) && alter === -1 ? 3 : 0)
      if (!best || score < best.score) best = { letter, written, score }
    }
  }
  return best!
}
function noteText(letter: string, written: number, acc: string | undefined, units: number, tie: boolean): string {
  const k = (written - 60 - NATURAL[letter]) / 12
  const name = k >= 1 ? letter.toLowerCase() + "'".repeat(k - 1) : letter + ','.repeat(-k)
  return (acc ?? '') + name + (units === 1 ? '' : String(units)) + (tie ? '-' : '')
}

/** Make one change to a valid score. The result is valid too, or the change is refused with a reason. */
export function edit(text: string, at: number, op: Op): EditResult {
  const score = check(text)
  if (score.problems.length) return { error: 'The note buttons work once the score has no problems. Fix the ones listed, or undo.' }
  const target = locate(score, at)
  if (!target && op.kind !== 'bar') return { error: 'Pick a note first: click one in the score.' }
  const perUnit = WHOLE / score.unit
  const model: Record<VoiceName, BarModel[]> = { Vocal: [], Ins: [] }
  for (const voice of VOICES) {
    for (const bar of score.bars[voice]) {
      model[voice].push({
        bar,
        units: bar.ticks / perUnit,
        items: bar.z ? null : bar.toks.filter(t => t.kind === 'note' || t.kind === 'rest').map(t => ({ rest: t.kind === 'rest', units: t.units!, pitch: t.pitch ?? 0, letter: t.letter ?? '', written: t.written ?? 0, tie: !!t.tie, orig: t })),
        marks: bar.toks.filter(t => t.kind === 'chord' || t.kind === 'key').map(t => ({ onset: t.onset / perUnit, chord: t.kind === 'chord' ? t.value : undefined, key: t.kind === 'key' ? t.value : undefined, orig: t })),
      })
    }
  }
  let insertAfter = -1
  let select: { voice: VoiceName; bar: number; onset: number }
  if (op.kind === 'bar') {
    insertAfter = target ? target.bar : score.bars.Vocal.length - 1
    select = { voice: 'Vocal', bar: insertAfter + 1, onset: 0 }
    // nothing may tie into the new, empty bar
    for (const voice of VOICES) { const last = model[voice][insertAfter].items?.at(-1); if (last) last.tie = false }
  } else {
    const result = apply(model, target!, op, score)
    if (typeof result === 'string') return { error: result }
    select = result
  }
  const out = serialize(score, model, insertAfter)
  const after = check(out)
  if (after.problems.length) return { error: 'That change would break the score, so it was not made.' }
  const bar = after.bars[select.voice][select.bar]
  if (!bar) return { text: out, start: 0, end: 0 }
  if (bar.z) return { text: out, start: bar.start, end: bar.end }
  const items = bar.toks.filter(t => t.kind === 'note' || t.kind === 'rest')
  const tick = select.onset * perUnit
  const tok = items.find(t => t.onset === tick) ?? items.find(t => t.onset <= tick && tick < t.onset + t.units! * perUnit) ?? items[0]
  return { text: out, start: tok.start, end: tok.end }
}

/** Apply an op to the bar models. Returns a reason it can't, or where the selection goes. */
function apply(model: Record<VoiceName, BarModel[]>, target: Target, op: Exclude<Op, { kind: 'bar' }>, score: Score): string | { voice: VoiceName; bar: number; onset: number } {
  const bars = model[target.voice]
  const bm = bars[target.bar]
  // a whole-bar rest becomes rests that can be edited
  if (!bm.items && op.kind !== 'delete') {
    if (!Number.isInteger(bm.units)) return `This bar can't hold notes at L:1/${score.unit}.`
    bm.items = fill(bm.units).map(restItem)
  }
  if (!bm.items) return 'That bar is already a rest.'
  const index = Math.max(0, target.item)
  const items = bm.items
  const item = items[index]
  const onsetOf = (i: number): number => items.slice(0, i).reduce((n, x) => n + x.units, 0)
  const here = { voice: target.voice, bar: target.bar, onset: onsetOf(index) }
  const keyAt = (b: BarModel, onset: number): string => b.marks.filter(m => m.key && m.onset <= onset).pop()?.key ?? b.bar.key
  // every item of the voice in order, to follow ties across barlines
  const flat: { b: number; i: number }[] = []
  bars.forEach((b, bi) => { if (b.items) b.items.forEach((_, i) => flat.push({ b: bi, i })); else flat.push({ b: bi, i: -1 }) })
  const get = (x: { b: number; i: number }): Item | null => (x.i < 0 ? null : bars[x.b].items![x.i])
  const chain = (): Item[] => {
    let k = flat.findIndex(x => x.b === target.bar && x.i === index)
    let first = k
    while (first > 0 && get(flat[first - 1])?.tie && !get(flat[first - 1])!.rest) first--
    while (k < flat.length - 1 && get(flat[k])?.tie && !get(flat[k])!.rest) k++
    return flat.slice(first, k + 1).map(get).filter((x): x is Item => !!x && !x.rest)
  }
  const toNote = (): void => {
    // a rest becomes a note at the pitch of the note before it (or the middle line, B)
    const k = flat.findIndex(x => x.b === target.bar && x.i === index)
    const prev = flat.slice(0, k).map(get).reverse().find(x => x && !x.rest)
    const spelled = prev ? { letter: prev.letter, written: prev.written, pitch: prev.pitch } : { letter: 'B', written: 71, pitch: 71 + keyAcc(keyAt(bm, here.onset)).B }
    Object.assign(item, { rest: false, tie: false, orig: undefined }, spelled)
  }
  const repitch = (members: Item[], pitch: number, spelled: { letter: string; written: number }): string | null => {
    if (pitch < 0 || pitch > 127 || pitch - spelled.written < -2 || pitch - spelled.written > 2) return 'That note is already as far as it goes.'
    for (const m of members) Object.assign(m, { pitch }, spelled)
    return null
  }

  switch (op.kind) {
    case 'step': case 'semitone': case 'octave': {
      if (item.rest) { toNote(); return here }
      const members = chain()
      let failure: string | null
      if (op.kind === 'step') {
        const spelled = stepSpelling(item.letter, item.written, op.dir)
        failure = repitch(members, spelled.written + keyAcc(keyAt(bm, here.onset))[spelled.letter], spelled)
      } else if (op.kind === 'semitone') {
        failure = repitch(members, item.pitch + op.dir, spell(item.pitch + op.dir, keyAt(bm, here.onset), op.dir))
      } else {
        failure = repitch(members, item.pitch + 12 * op.dir, { letter: item.letter, written: item.written + 12 * op.dir })
      }
      return failure ?? here
    }
    case 'length': case 'dot': {
      const old = item.units
      const units = op.kind === 'length' ? op.units : isDotted(old) ? (old * 2) / 3 : (old * 3) / 2
      if (!ALLOWED.has(units)) return op.kind === 'dot' ? 'That length has no dotted version YuE2 can read.' : `YuE2 can't use that length at L:1/${score.unit}.`
      if (units === old) return 'It is already that length.'
      if (units > old) {
        if (here.onset + units > bm.units) return "There isn't room for that length in this bar. Shorten a later note or rest first."
        let need = units - old
        while (need > 0) {
          const next = items[index + 1]
          if (next.units <= need) { need -= next.units; items.splice(index + 1, 1) } else { next.units -= need; need = 0 }
        }
      } else items.splice(index + 1, 0, ...fill(old - units).map(restItem))
      item.units = units
      return here
    }
    case 'rest': {
      if (item.rest) { toNote(); return here }
      for (const m of chain()) Object.assign(m, restItem(m.units))
      return here
    }
    case 'delete': {
      const [gone] = items.splice(index, 1)
      items.push(...fill(gone.units).map(restItem))
      return here
    }
    case 'insert': {
      if (item.units < 2) return 'This note is too short to split. Make it longer first.'
      const first = item.units % 2 === 0 ? item.units / 2 : item.units - 1
      const second: Item = { ...item, units: item.units - first, orig: undefined }
      Object.assign(item, { units: first, tie: false })
      items.splice(index + 1, 0, second)
      return { ...here, onset: here.onset + first }
    }
    case 'chord': {
      if (target.voice !== 'Vocal') return 'Chord symbols go in the Vocal part. Pick a Vocal note.'
      const symbol = op.symbol.trim()
      if (symbol && !CHORD.test(symbol)) return `YuE2 doesn't know the chord “${symbol}”. It knows chords like C, Cm, C7, Cmaj7, Cm7, Cdim, Caug, Csus4, C6 and C/E.`
      const existing = bm.marks.findIndex(m => m.chord !== undefined && m.onset === here.onset)
      if (existing >= 0) {
        if (symbol) bm.marks[existing] = { onset: here.onset, chord: symbol }
        else bm.marks.splice(existing, 1)
      } else if (symbol) {
        const pos = bm.marks.findIndex(m => m.onset >= here.onset)
        bm.marks.splice(pos < 0 ? bm.marks.length : pos, 0, { onset: here.onset, chord: symbol })
      } else return 'There is no chord symbol on that note.'
      return here
    }
  }
}

interface Piece extends Item { onset: number }
/** a bar's items as tokens YuE2 reads: split where a chord or key change falls, and into lengths YuE2 knows */
function layout(bm: BarModel): (Piece | Mark)[] {
  const out: (Piece | Mark)[] = []
  let pos = 0, mark = 0
  for (const item of bm.items!) {
    const end = pos + item.units
    const bounds = [pos, ...new Set(bm.marks.filter(m => m.onset > pos && m.onset < end).map(m => m.onset)), end]
    const parts: number[] = []
    for (let k = 0; k + 1 < bounds.length; k++) parts.push(...fill(bounds[k + 1] - bounds[k]))
    let at = pos
    parts.forEach((units, k) => {
      while (mark < bm.marks.length && bm.marks[mark].onset <= at) out.push(bm.marks[mark++])
      out.push({ ...item, units, onset: at, tie: !item.rest && (k < parts.length - 1 || item.tie), orig: parts.length === 1 ? item.orig : undefined })
      at += units
    })
    pos = end
  }
  while (mark < bm.marks.length) out.push(bm.marks[mark++])
  return out
}

function serialize(score: Score, model: Record<VoiceName, BarModel[]>, insertAfter: number): string {
  // ties only between equal notes, never into a rest or past the end
  for (const voice of VOICES) {
    const flat: (Item | null)[] = model[voice].flatMap(b => (b.items ? b.items : [null]))
    flat.forEach((x, k) => { if (x?.tie && (x.rest || !flat[k + 1] || flat[k + 1]!.rest || flat[k + 1]!.pitch !== x.pitch)) x.tie = false })
  }
  // write each bar again; a bar comes out as it was unless something in it changed
  const barText: Record<VoiceName, (string | null)[]> = { Vocal: [], Ins: [] }
  for (const voice of VOICES) {
    let pending: { pitch: number; written: number } | null = null
    for (const bm of model[voice]) {
      if (!bm.items) { barText[voice].push(null); pending = null; continue }
      let key = bm.bar.key
      let local: Record<string, number> = {}
      const toks: string[] = []
      for (const p of layout(bm)) {
        if (!('units' in p)) {
          if (p.key) { key = p.key; local = {} }
          toks.push(p.orig?.text ?? (p.chord !== undefined ? `"${p.chord}"` : `[K:${p.key}]`))
          continue
        }
        if (p.rest) {
          toks.push(p.orig && p.orig.kind === 'rest' && p.orig.units === p.units ? p.orig.text : 'z' + (p.units === 1 ? '' : p.units))
          pending = null
          continue
        }
        const need = p.pitch - p.written
        const origAcc = p.orig?.kind === 'note' && p.orig.acc && ALT[p.orig.acc] === need && p.orig.written === p.written ? p.orig.acc : undefined
        let acc: string | undefined
        if (pending && p.written === pending.written && p.pitch === pending.pitch) acc = origAcc
        else acc = origAcc ?? ((local[p.letter] ?? keyAcc(key)[p.letter]) === need ? undefined : ACC[need + 2])
        if (acc) local[p.letter] = ALT[acc]
        const o = p.orig
        const same = o && o.kind === 'note' && o.units === p.units && !!o.tie === p.tie && o.letter === p.letter && o.written === p.written && o.acc === acc
        toks.push(same ? o.text : noteText(p.letter, p.written, acc, p.units, p.tie))
        pending = p.tie ? { pitch: p.pitch, written: p.written } : null
      }
      const orig = bm.bar.toks.map(t => t.text)
      barText[voice].push(bm.bar.z || toks.length !== orig.length || toks.some((t, k) => t !== orig[k]) ? toks.join('') : null)
    }
  }
  // rebuild only the music lines that changed
  const lines = score.lines.map(l => ({ text: l.text, sep: l.sep }))
  const extra = new Map<number, string[]>()
  const groupEnd = new Map<number, number>()
  for (const ml of score.music) groupEnd.set(ml.group, Math.max(groupEnd.get(ml.group) ?? 0, ml.line))
  const overflow: Record<string, string> = {}
  for (const ml of score.music) {
    let changed = false
    const segs = ml.segs.map(seg => {
      const texts = seg.bars.map(b => barText[ml.voice][b] ?? (score.bars[ml.voice][b].z ? 'Z' : seg.text.trim()))
      let touched = seg.bars.some(b => barText[ml.voice][b] !== null)
      if (insertAfter >= 0) {
        const k = seg.bars.indexOf(insertAfter)
        if (k >= 0) { texts.splice(k + 1, 0, 'Z'); touched = true }
      }
      changed ||= touched
      return { raw: seg.text, texts, touched }
    })
    if (segs.reduce((n, s) => n + s.texts.length, 0) > 4) {
      const last = segs[segs.length - 1]
      overflow[`${ml.group}:${ml.voice}`] = last.texts.pop()!
      last.touched = true
      if (!last.texts.length) segs.pop()
      changed = true
    }
    if (!changed) continue
    lines[ml.line].text = segs.map(s => (s.touched ? compressRests(s.texts) : s.raw)).join('|') + '|'
  }
  for (const [group, end] of groupEnd) {
    const v = overflow[`${group}:Vocal`], i = overflow[`${group}:Ins`]
    if (v !== undefined && i !== undefined) extra.set(end, ['V: Vocal', `${v}|`, 'V: Ins', `${i}|`])
  }
  let out = ''
  lines.forEach((l, k) => {
    const more = extra.get(k)
    if (!more) { out += l.text + l.sep; return }
    const sep = l.sep || '\n'
    out += l.text + sep + more.join(sep) + l.sep
  })
  return out
}

/** runs of whole-bar rests written the way YuE2 writes them: Z, Z2, Z3, Z4 */
function compressRests(texts: string[]): string {
  const out: string[] = []
  for (const t of texts) {
    const last = out[out.length - 1]
    const run = last === undefined ? 0 : last === 'Z' ? 1 : /^Z[23]$/.test(last) ? Number(last[1]) : 0
    if (t === 'Z' && run) out[out.length - 1] = `Z${run + 1}`
    else out.push(t)
  }
  return out.join('|')
}

// ---- helpers for the page -------------------------------------------------

/** L: units of a note value (4 = quarter note), or 0 when the score's L: can't write it */
export function unitsOf(score: Score, noteValue: number): number {
  const u = score.unit / noteValue
  return Number.isInteger(u) && u >= 1 ? u : 0
}

/** A new, empty score in YuE2's format. */
export function newScore(o: { bpm: number; meter: [number, number]; key: string; bars: number }): string {
  const [n, d] = o.meter
  const unit = Math.max(16, d)
  const rest = fill((n * unit) / d).map(u => 'z' + (u === 1 ? '' : u)).join('')
  const lines = ['X:1', 'T:', `M:${n}/${d}`, `L:1/${unit}`, `Q:1/4=${Math.round(o.bpm)}`, ...VOICE_LINES, `K:${o.key}`]
  for (let b = 0; b < o.bars; b += 4) {
    const count = Math.min(4, o.bars - b)
    lines.push('V: Vocal', Array(count).fill(rest).join('|') + '|', 'V: Ins', `Z${count === 1 ? '' : count}|`)
  }
  return lines.join('\n') + '\n'
}

/** A note's name for people: E4, F#5, Bb3 */
export function noteName(tok: Tok): string {
  const alter = tok.pitch! - tok.written!
  return tok.letter! + (alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter)) + String(Math.floor(tok.written! / 12) - 1)
}
