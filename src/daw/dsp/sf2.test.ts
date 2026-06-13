// Verifies the .sf2 parser against a hand-built minimal SoundFont: one sample,
// one instrument zone (root-key override + loop), one preset. Building the RIFF
// in-memory means no binary fixture on disk and exercises every chunk the parser
// reads.
import { describe, expect, it } from 'vitest'
import { parseSf2, zonesForNote } from './sf2'

// ---- tiny SF2 builder ----
const enc = (s: string, n: number): Uint8Array => {
  const out = new Uint8Array(n)
  for (let i = 0; i < Math.min(s.length, n); i++) out[i] = s.charCodeAt(i)
  return out
}
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const len = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
const u16 = (v: number): Uint8Array => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b }
const u32 = (v: number): Uint8Array => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b }
const s16 = (v: number): Uint8Array => { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v, true); return b }
const chunk = (id: string, body: Uint8Array): Uint8Array => {
  const head = concat(enc(id, 4), u32(body.length))
  return body.length & 1 ? concat(head, body, new Uint8Array(1)) : concat(head, body)
}
const list = (type: string, ...subs: Uint8Array[]): Uint8Array => chunk('LIST', concat(enc(type, 4), ...subs))
const gen = (op: number, amount: number): Uint8Array => concat(u16(op), s16(amount))
const keyRangeAmount = (lo: number, hi: number): number => lo | (hi << 8)

function buildSf2(): ArrayBuffer {
  const N = 200
  // sample pool: a sine
  const smplBody = new Uint8Array(N * 2)
  const dv = new DataView(smplBody.buffer)
  for (let i = 0; i < N; i++) dv.setInt16(i * 2, Math.round(Math.sin((i / N) * Math.PI * 8) * 20000), true)

  const sdta = list('sdta', chunk('smpl', smplBody))

  // shdr: tone + terminal
  const shdrRec = (name: string, start: number, end: number, ls: number, le: number, sr: number, root: number, type: number): Uint8Array =>
    concat(enc(name, 20), u32(start), u32(end), u32(ls), u32(le), u32(sr), new Uint8Array([root, 0]), u16(0), u16(type))
  const shdr = chunk('shdr', concat(
    shdrRec('tone', 0, N, 10, N - 10, 44100, 60, 1),
    shdrRec('EOS', 0, 0, 0, 0, 0, 0, 0),
  ))

  // instrument generators: keyRange, rootKey override, loop on, sampleID (last) + terminal
  const igen = chunk('igen', concat(
    gen(43, keyRangeAmount(0, 127)),
    gen(58, 69), // overridingRootKey
    gen(54, 1), // sampleModes = loop
    gen(53, 0), // sampleID (must be last)
    gen(0, 0), // terminal
  ))
  const ibag = chunk('ibag', concat(u16(0), u16(0), u16(4), u16(0))) // zone bag + terminal
  const imod = chunk('imod', new Uint8Array(10)) // one terminal mod
  const inst = chunk('inst', concat(
    concat(enc('inst0', 20), u16(0)),
    concat(enc('EOI', 20), u16(1)),
  ))

  // preset generators: instrument pointer + terminal
  const pgen = chunk('pgen', concat(gen(41, 0), gen(0, 0)))
  const pbag = chunk('pbag', concat(u16(0), u16(0), u16(1), u16(0)))
  const pmod = chunk('pmod', new Uint8Array(10))
  const phdr = chunk('phdr', concat(
    concat(enc('Preset0', 20), u16(0), u16(0), u16(0), u32(0), u32(0), u32(0)),
    concat(enc('EOP', 20), u16(0), u16(0), u16(1), u32(0), u32(0), u32(0)),
  ))

  const pdta = list('pdta', phdr, pbag, pmod, pgen, inst, ibag, imod, igen, shdr)
  const info = list('INFO', chunk('ifil', concat(u16(2), u16(1))))
  const body = concat(enc('sfbk', 4), info, sdta, pdta)
  return chunk('RIFF', body).buffer as ArrayBuffer
}

describe('sf2 parser', () => {
  const sf = parseSf2(buildSf2())

  it('reads the sample pool and headers', () => {
    expect(sf.samples).toHaveLength(1)
    const s = sf.samples[0]
    expect(s.name).toBe('tone')
    expect(s.sampleRate).toBe(44100)
    expect(s.originalPitch).toBe(60)
    expect(s.data.length).toBe(200)
    expect(s.loopStart).toBe(10)
    expect(s.loopEnd).toBe(190)
  })

  it('resolves the preset → instrument → zone hierarchy', () => {
    expect(sf.presets).toHaveLength(1)
    const p = sf.presets[0]
    expect(p.name).toBe('Preset0')
    expect(p.program).toBe(0)
    expect(p.zones).toHaveLength(1)
    const z = p.zones[0]
    expect(z.sampleIndex).toBe(0)
    expect(z.rootKey).toBe(69) // override applied, not the sample's 60
    expect(z.loop).toBe(true)
    expect(z.keyLo).toBe(0)
    expect(z.keyHi).toBe(127)
  })

  it('selects zones by key + velocity', () => {
    const p = sf.presets[0]
    expect(zonesForNote(p, 69, 0.8)).toHaveLength(1)
    expect(zonesForNote(p, 200, 0.8)).toHaveLength(0) // out of key range
  })

  it('rejects non-SoundFont data', () => {
    expect(() => parseSf2(new ArrayBuffer(32))).toThrow()
  })
})
