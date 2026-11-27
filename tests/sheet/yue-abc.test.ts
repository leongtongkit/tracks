// The sheet music editor speaks YuE2's score format. These tests hold it to
// YuE2's own checker (e2e/yue2/abc_tools.py, copied from the YuE repository):
// the official examples open and save unchanged, random runs of note-button
// edits always give a score YuE2 accepts with the notes the editor shows, and
// the editor's checker agrees with YuE2's about what is broken.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseAbc } from '../../src/daw/abc'
import { check, DURATIONS, edit, MAJOR_KEYS, MINOR_KEYS, newScore, type Op, type Score, type VoiceName } from '../../src/sheet/yue-abc'
import { fromFile, toFile } from '../../src/sheet/file'
import { inspectCli, root, yue2 } from './yue2'

const EXAMPLES = ['melody.abc', 'score.abc', 'score-jazz.abc']
const example = (name: string): Uint8Array => new Uint8Array(readFileSync(root(`e2e/yue2/${name}`)))

const frac = (ticks: number): string => {
  // ticks are 1/1024 whole notes; Python prints quarter notes as a reduced fraction
  let n = ticks, d = 256
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
  const k = g(n, d); n /= k; d /= k
  return d === 1 ? String(n) : `${n}/${d}`
}
const notesOf = (s: Score): Record<VoiceName, string[]> => ({
  Vocal: s.notes.Vocal.map(n => `${frac(n.onset)}:${n.pitch}:${frac(n.dur)}`),
  Ins: s.notes.Ins.map(n => `${frac(n.onset)}:${n.pitch}:${frac(n.dur)}`),
})
/** the notes the studio's own importer reads from the same text, in the same form */
const importedNotes = (text: string): Record<string, string[]> => {
  const parsed = parseAbc(text)
  const out: Record<string, string[]> = {}
  for (const v of parsed.voices) out[v.name] = v.notes.map(n => `${frac(Math.round(n.start * 256))}:${n.pitch}:${frac(Math.round(n.dur * 256))}`)
  return out
}

function rng(seed: number): () => number {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

describe('YuE2 official examples', () => {
  for (const name of EXAMPLES) {
    it(`${name} opens with no problems and saves byte for byte`, () => {
      const bytes = example(name)
      const text = fromFile(bytes)
      const score = check(text)
      expect(score.problems).toEqual([])
      expect(Buffer.from(toFile(text))).toEqual(Buffer.from(bytes))
      const [verdict] = yue2([text])
      expect(verdict.ok).toBe(true)
      expect(notesOf(score)).toEqual(verdict.notes)
    })
  }
})

describe('note buttons keep the score the way YuE2 needs it', () => {
  const starts = [
    ...EXAMPLES.map(name => fromFile(example(name))),
    newScore({ bpm: 96, meter: [4, 4], key: 'G', bars: 6 }),
    newScore({ bpm: 72, meter: [3, 4], key: 'Eb', bars: 5 }),
    newScore({ bpm: 120, meter: [6, 8], key: 'F#m', bars: 4 }),
    newScore({ bpm: 60, meter: [2, 4], key: 'Bbm', bars: 3 }),
  ]
  const chords = ['C', 'Am', 'F#m7', 'Bbmaj7', 'G7sus4', 'Dm7b5', 'C/E', 'Ebaug', '', 'Cadd9', 'H7']
  const pickOp = (r: () => number): Op => {
    const ops: Op[] = [
      { kind: 'step', dir: 1 }, { kind: 'step', dir: -1 }, { kind: 'semitone', dir: 1 }, { kind: 'semitone', dir: -1 },
      { kind: 'octave', dir: 1 }, { kind: 'octave', dir: -1 }, { kind: 'length', units: DURATIONS[Math.floor(r() * DURATIONS.length)] },
      { kind: 'dot' }, { kind: 'rest' }, { kind: 'delete' }, { kind: 'insert' }, { kind: 'chord', symbol: chords[Math.floor(r() * chords.length)] }, { kind: 'bar' },
    ]
    return ops[Math.floor(r() * ops.length)]
  }
  const pickAt = (r: () => number, text: string): number => {
    const s = check(text)
    const spots = (['Vocal', 'Ins'] as const).flatMap(v => s.bars[v].flatMap(b => (b.z ? [b.start] : b.toks.filter(t => t.kind === 'note' || t.kind === 'rest').map(t => t.start))))
    return spots[Math.floor(r() * spots.length)]
  }

  it('60 random runs of edits: YuE2 accepts every result and reads the same notes the editor shows', () => {
    const results: { text: string; score: Score }[] = []
    let applied = 0
    const refusals = new Set<string>()
    for (let run = 0; run < 60; run++) {
      const r = rng(1000 + run)
      let text = starts[run % starts.length]
      const steps = 3 + Math.floor(r() * 10)
      for (let k = 0; k < steps; k++) {
        const result = edit(text, pickAt(r, text), pickOp(r))
        if ('error' in result) { refusals.add(result.error); continue }
        text = result.text
        applied++
        const score = check(text)
        expect(score.problems, text).toEqual([])
        results.push({ text, score })
      }
    }
    // a refused edit is fine (no room, already that length...), a broken one never
    expect([...refusals].filter(m => /would break/.test(m))).toEqual([])
    expect(applied).toBeGreaterThan(300)
    const verdicts = yue2(results.map(x => x.text))
    verdicts.forEach((v, i) => {
      expect(v, results[i].text).toMatchObject({ ok: true })
      expect(notesOf(results[i].score), results[i].text).toEqual(v.notes)
    })
    // and the studio reads the same notes when the score is sent there
    for (const { text, score } of results.filter((_, i) => i % 10 === 0)) {
      const imported = importedNotes(text)
      const mine = notesOf(score)
      if (mine.Vocal.length) expect(imported['Vocal Melody']).toEqual(mine.Vocal)
      if (mine.Ins.length) expect(imported['Ins Melody']).toEqual(mine.Ins)
    }
  })

  it('raising one note a step changes only that note', () => {
    const text = fromFile(example('score.abc'))
    const at = text.indexOf('E2G2A2G2E2D2C4')
    const result = edit(text, at, { kind: 'step', dir: 1 })
    if ('error' in result) throw new Error(result.error)
    const before = text.split('\n'), after = result.text.split('\n')
    const changed = before.flatMap((l, i) => (l === after[i] ? [] : [i]))
    expect(changed).toHaveLength(1)
    expect(before[changed[0]]).toBe('"C"E2G2A2G2E2D2C4|"G"D2E2G2E2D2C2D4|"Am"E2G2A2c2B2A2G4|"F"F2E2D2E2G2E2C4|')
    expect(after[changed[0]]).toBe('"C"F2G2A2G2E2D2C4|"G"D2E2G2E2D2C2D4|"Am"E2G2A2c2B2A2G4|"F"F2E2D2E2G2E2C4|')
    expect(result.text.slice(result.start, result.end)).toBe('F2')
    expect(inspectCli(result.text)).toBe(0)
  })

  it('a chord on a held note splits it with a tie, as YuE2 asks', () => {
    const text = newScore({ bpm: 88, meter: [4, 4], key: 'C', bars: 1 })
    let r = edit(text, text.indexOf('z16'), { kind: 'step', dir: 1 }) // the rest becomes a note
    if ('error' in r) throw new Error(r.error)
    const third = edit(r.text, r.start, { kind: 'insert' })
    if ('error' in third) throw new Error(third.error)
    r = edit(third.text, third.start, { kind: 'chord', symbol: 'G7' })
    if ('error' in r) throw new Error(r.error)
    const merged = edit(r.text, r.text.indexOf('B8'), { kind: 'length', units: 16 })
    if ('error' in merged) throw new Error(merged.error)
    expect(merged.text).toContain('V: Vocal\nB8-"G7"B8|')
    expect(inspectCli(merged.text)).toBe(0)
  })

  it('adding a bar to a full line starts a new section line', () => {
    const text = fromFile(example('melody.abc'))
    const r = edit(text, text.indexOf('F2E2D2E2G2E2C4'), { kind: 'bar' })
    if ('error' in r) throw new Error(r.error)
    expect(r.text).toContain('V: Vocal\nE2G2A2G2E2D2C4|D2E2G2E2D2C2D4|E2G2A2c2B2A2G4|F2E2D2E2G2E2C4|\nV: Ins\nZ4|\nV: Vocal\nZ|\nV: Ins\nZ|\n% chorus')
    expect(check(r.text).bars.Vocal).toHaveLength(9)
    expect(inspectCli(r.text)).toBe(0)
  })

  it('chords stay in the Vocal part', () => {
    const text = fromFile(example('melody.abc'))
    const r = edit(text, text.indexOf('Z4'), { kind: 'chord', symbol: 'C' })
    expect(r).toEqual({ error: expect.stringMatching(/Vocal part/) })
  })
})

describe('the checker says what YuE2 would reject', () => {
  it('flags a bar that is too long, in plain words (negative control)', () => {
    const text = fromFile(example('score.abc')).replace('"Am"E2G2A2c2B2A2G4|', '"Am"E2G2A2c2B2A2G4A2|')
    const score = check(text)
    expect(score.problems.map(p => p.message)).toEqual(['Bar 3 of the Vocal part is longer than 4/4 (it adds up to 4½ beats; the bar holds 4).'])
    expect(text.slice(score.problems[0].start, score.problems[0].end)).toBe('"Am"E2G2A2c2B2A2G4A2')
    expect(inspectCli(text)).toBe(2)
    expect(yue2([text])[0]).toMatchObject({ ok: false, error: expect.stringMatching(/group 1, Vocal, bar 3/) })
  })

  it('names a missing Ins bar', () => {
    const text = fromFile(example('melody.abc')).replace('V: Ins\nZ4|\n% chorus', 'V: Ins\nZ3|\n% chorus')
    expect(check(text).problems.map(p => p.message)).toEqual(['The Ins part is missing bar 4: the Vocal and Ins lines of a section need the same number of bars.'])
    expect(inspectCli(text)).toBe(2)
  })

  it('agrees with YuE2 on 400 damaged copies of the examples', () => {
    const r = rng(7)
    const pieces = ['|', '-', '2', '3', '5', 'z', 'Z', '^', '_', '=', ',', "'", '"C"', '"Cadd9"', '[K:G]', '[K:H]', 'c', 'B,', ' ', '\n', '%', 'V: Ins', 'M:3/4', '"', 'x']
    const texts: string[] = []
    for (let k = 0; k < 400; k++) {
      let text = fromFile(example(EXAMPLES[k % 3]))
      for (let n = 1 + Math.floor(r() * 2); n > 0; n--) {
        const at = 8 + Math.floor(r() * (text.length - 8))
        const what = r()
        const letters = [...text.slice(text.indexOf('K:')).matchAll(/(?<=[0-9|"-]|^)[A-Ga-g](?=[0-9])/gm)].map(m => m.index + text.indexOf('K:'))
        if (what < 0.35 && letters.length) {
          // another note of the same length: usually still a good score
          const spot = letters[Math.floor(r() * letters.length)]
          text = text.slice(0, spot) + ['^', '_', '=', '', '', ''][Math.floor(r() * 6)] + 'CDEFGABcdefgab'[Math.floor(r() * 14)] + ["'", ',', '', '', ''][Math.floor(r() * 5)] + text.slice(spot + 1)
        } else if (what < 0.6) text = text.slice(0, at) + text.slice(at + 1 + Math.floor(r() * 3))
        else text = text.slice(0, at) + pieces[Math.floor(r() * pieces.length)] + text.slice(at)
      }
      texts.push(text)
    }
    const verdicts = yue2(texts)
    const disagree = texts.filter((t, i) => (check(t).problems.length === 0) !== verdicts[i].ok)
    expect(disagree).toEqual([])
    // the damage really did break some and leave others readable
    expect(verdicts.filter(v => v.ok).length).toBeGreaterThan(20)
    expect(verdicts.filter(v => !v.ok).length).toBeGreaterThan(100)
    // where both accept a score, they read the same notes
    texts.forEach((t, i) => { if (verdicts[i].ok) expect(notesOf(check(t))).toEqual(verdicts[i].notes) })
  })

  it('every key in the key picker is one YuE2 knows', () => {
    const texts = [...MAJOR_KEYS, ...MINOR_KEYS].map(key => newScore({ bpm: 90, meter: [4, 4], key, bars: 2 }))
    expect(texts.every(t => check(t).problems.length === 0)).toBe(true)
    expect(yue2(texts).every(v => v.ok)).toBe(true)
  })
})
