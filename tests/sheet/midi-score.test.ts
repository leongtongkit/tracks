// YuE2 song pages hand out a song's score as MIDI (parts named Vocal Melody and
// Ins Melody). The sheet music editor opens it as a YuE2 score: these tests hold
// the result to YuE2's own checker and to the notes in the file, snapped to YuE2's
// sixteenth-note grid.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importMidi } from '../../src/daw/midi'
import { midiToScore, type MidiScore } from '../../src/sheet/midi-score'
import { check } from '../../src/sheet/yue-abc'
import { smf, type SmfTrack } from './smf'
import { inspectCli, root, yue2 } from './yue2'

const opened = (r: MidiScore | { error: string }): MidiScore => {
  if ('error' in r) throw new Error(r.error)
  return r
}
/** quarter notes as Python prints a Fraction */
const q = (sixteenths: number): string => {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
  const k = g(sixteenths, 4)
  return 4 / k === 1 ? String(sixteenths / k) : `${sixteenths / k}/${4 / k}`
}
/** the notes YuE2 should read: each snapped to the nearest sixteenth */
const expected = (notes: [number, number, number][]): string[] =>
  notes.map(([s, d, p]) => {
    const a = Math.round(s * 4), b = Math.max(a + 1, Math.round((s + d) * 4))
    return `${q(a)}:${p}:${q(b - a)}`
  })

describe('opening a MIDI file in the sheet music editor', () => {
  const vocal: [number, number, number][] = [[0, 0.5, 67], [0.51, 0.49, 69], [1, 2, 71], [3, 1.5, 74], [4.5, 1.5, 66], [6, 3, 67]]
  const ins: [number, number, number][] = [[0, 1, 55], [1, 1, 59], [2, 1, 62], [3, 3, 55], [6, 2.98, 50]]

  it('a two-part YuE2 MIDI file opens to the right parts, and YuE2 takes the saved score with the same notes', () => {
    // Ins first in the file: the names decide, not the order
    const bytes = smf([{ name: 'Ins Melody', notes: ins }, { name: 'Vocal Melody', notes: vocal }], { bpm: 90, meter: [3, 2], key: [1, 0], title: 'Song' })
    const r = opened(midiToScore(bytes))
    expect(r.from).toEqual({ Vocal: 'Vocal Melody', Ins: 'Ins Melody' })
    expect(r.text.split('\n').slice(0, 8)).toEqual(['X:1', 'T:', 'M:3/4', 'L:1/16', 'Q:1/4=90', 'V: Vocal clef=treble name="Vocal Melody" snm="Vocal"', 'V: Ins clef=treble name="Ins Melody" snm="Inst."', 'K:G'])
    expect(r.messages).toContain('Some notes were moved to the nearest sixteenth note.')
    expect(check(r.text).problems).toEqual([])
    expect(inspectCli(r.text)).toBe(0)
    const [verdict] = yue2([r.text])
    expect(verdict.ok).toBe(true)
    expect(verdict.notes!.Vocal).toEqual(expected(vocal))
    expect(verdict.notes!.Ins).toEqual(expected(ins))
  })

  it('a MIDI file with one unnamed part puts it in the Vocal part', () => {
    const part: [number, number, number][] = [[0, 1, 60], [1, 1, 62], [2, 2, 64], [4, 4, 67]]
    const r = opened(midiToScore(smf([{ notes: part }])))
    expect(r.from).toEqual({ Vocal: 'MIDI 1', Ins: null })
    expect(r.messages).toEqual(['Vocal part from “MIDI 1”.', 'The Ins part is empty.', 'The file has no key, so the score is in C major.'])
    expect(r.text).toContain('\nV: Ins\nZ2|\n')
    expect(inspectCli(r.text)).toBe(0)
    expect(yue2([r.text])[0].notes).toEqual({ Vocal: expected(part), Ins: [] })
  })

  it('a drums-only MIDI file gives a plain message, not a crash', () => {
    const drums = smf([{ name: 'Beat', channel: 9, notes: [[0, 0.25, 36], [1, 0.25, 38], [2, 0.25, 36], [3, 0.25, 38]] }])
    expect(() => midiToScore(drums)).not.toThrow()
    expect(midiToScore(drums)).toEqual({ error: 'That MIDI file only has drums. Sheet music needs a melody, so there is nothing to show.' })
  })

  it('other files and empty MIDI files give plain messages', () => {
    expect(midiToScore(new TextEncoder().encode('X:1\nT:\n'))).toEqual({ error: "That file isn't a MIDI file Tracks can read." })
    expect(midiToScore(smf([{ name: 'Vocal Melody', notes: [] }]))).toEqual({ error: 'That MIDI file has no notes in it.' })
  })

  it('keeps the top note where notes overlap, and says which parts were left out', () => {
    const chords: [number, number, number][] = [[0, 2, 60], [0, 2, 64], [0, 2, 67], [2, 2, 65]]
    const r = opened(midiToScore(smf([
      { name: 'Bass', notes: [[0, 4, 36]] },
      { name: 'Vocal Melody', notes: chords },
      { name: 'Ins Melody', notes: [[0, 4, 55]] },
      { name: 'Kit', channel: 9, notes: [[0, 1, 36]] },
    ])))
    expect(r.from).toEqual({ Vocal: 'Vocal Melody', Ins: 'Ins Melody' })
    expect(r.messages).toContain('Left out: “Bass”, “Kit”.')
    expect(r.messages).toContain('Where notes overlapped, the top note was kept.')
    expect(yue2([r.text])[0].notes!.Vocal).toEqual(['0:67:2', '2:65:2'])
  })

  it('reads the time signature, key and tempo from the file', () => {
    const p = importMidi(smf([{ notes: [[0, 1, 60]] }], { bpm: 72, meter: [6, 3], key: [-3, 1] }))
    expect(p.timeSig).toEqual({ num: 6, den: 8 })
    expect(p.key).toEqual({ root: 0, scale: 'minor' }) // three flats, minor: C minor
    expect(p.bpm).toBe(72)
    expect(opened(midiToScore(smf([{ notes: [[0, 1, 60]] }], { meter: [6, 3], key: [-3, 1] }))).text).toContain('\nM:6/8\nL:1/16\n')
  })

  it('a repeated note that starts a moment before the previous one ends keeps both notes', () => {
    // second E starts 10 ticks before the first one's note-off
    const p = importMidi(smf([{ notes: [[0, 1, 64], [1 - 10 / 480, 1, 64]] }]))
    const notes = p.tracks[0].clips[0].notes.map(n => [n.start, Number(n.dur.toFixed(3)), n.pitch])
    expect(notes).toEqual([[0, 1, 64], [1 - 10 / 480, 1, 64]])
  })

  it("the browser test's two-part MIDI file opens to both parts and YuE2 takes it", () => {
    const r = opened(midiToScore(new Uint8Array(readFileSync(root('e2e/yue2/two-part.mid')))))
    expect(r.from).toEqual({ Vocal: 'Vocal Melody', Ins: 'Ins Melody' })
    expect(inspectCli(r.text)).toBe(0)
    const notes = yue2([r.text])[0].notes!
    expect(notes.Vocal.length).toBeGreaterThan(8)
    expect(notes.Ins.length).toBeGreaterThan(4)
  })

  it('random two-part MIDI files always give a score YuE2 takes, with the snapped notes', () => {
    let seed = 7
    const rand = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]
    const meters: [number, number][] = [[4, 2], [3, 2], [2, 2], [6, 3], [12, 3], [5, 2]]
    const cases: { bytes: Uint8Array; parts: Record<'Vocal' | 'Ins', [number, number, number][]> }[] = []
    for (let i = 0; i < 40; i++) {
      const meter = pick(meters)
      const barSixteenths = (meter[0] * 16) / 2 ** meter[1]
      const span = barSixteenths * (1 + Math.floor(rand() * 9))
      const line = (low: number): [number, number, number][] => {
        const out: [number, number, number][] = []
        let t = Math.floor(rand() * 4)
        while (t < span) {
          const len = 1 + Math.floor(rand() * 12)
          const jitter = (): number => (rand() - 0.5) * 0.06 // under a quarter of a sixteenth
          out.push([t / 4 + jitter(), len / 4, low + Math.floor(rand() * 24)])
          t += len + (rand() < 0.3 ? 1 + Math.floor(rand() * 6) : 0)
        }
        return out.map(([s, d, p]) => [Math.max(0, s), d, p])
      }
      const parts = { Vocal: line(55), Ins: line(43) }
      const named: SmfTrack[] = [{ name: pick(['Vocal Melody', 'vocal', 'Lead Vocal']), notes: parts.Vocal }, { name: pick(['Ins Melody', 'Ins', 'Instrument']), notes: parts.Ins }]
      cases.push({ bytes: smf(rand() < 0.5 ? named : named.reverse(), { bpm: 60 + Math.floor(rand() * 100), meter, key: [Math.floor(rand() * 15) - 7, rand() < 0.5 ? 0 : 1] }), parts })
    }
    const scores = cases.map(c => opened(midiToScore(c.bytes)))
    for (const s of scores) expect(check(s.text).problems).toEqual([])
    const verdicts = yue2(scores.map(s => s.text))
    verdicts.forEach((v, i) => {
      expect(v.error).toBeUndefined()
      // the jitter can push an end past the next start by a hair; snapped, they meet exactly
      expect(v.notes).toEqual({ Vocal: expected(cases[i].parts.Vocal), Ins: expected(cases[i].parts.Ins) })
    })
  })
})
