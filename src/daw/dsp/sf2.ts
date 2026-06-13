// Minimal SoundFont 2 (.sf2) parser → a flat, playable model. Reads the RIFF
// sfbk structure (INFO / sdta / pdta), resolves the preset→instrument→sample
// generator hierarchy (with global zones and the standard preset-adds-to-
// instrument rule for the generators we use), and exposes presets whose zones
// carry everything the SoundFontInstrument needs to play: key/velocity ranges,
// sample, root key, tuning, loop, and a volume ADSR. Pure (ArrayBuffer in,
// plain objects out) so it is node-testable.

export interface Sf2Sample {
  name: string
  data: Float32Array // mono PCM, -1..1
  sampleRate: number
  loopStart: number // sample frames, relative to data
  loopEnd: number
  originalPitch: number // MIDI key the sample was recorded at
  pitchCorrection: number // cents
}

export interface Sf2Zone {
  keyLo: number
  keyHi: number
  velLo: number
  velHi: number
  sampleIndex: number
  rootKey: number // effective root (override or sample original)
  tuneCents: number // coarse*100 + fine, applied on top of root
  loop: boolean
  // volume envelope, seconds (sustain is a 0..1 level)
  attack: number
  hold: number
  decay: number
  sustain: number
  release: number
  pan: number // -1..1
  gain: number // linear, from initialAttenuation
}

export interface Sf2Preset {
  name: string
  bank: number
  program: number
  zones: Sf2Zone[]
}

export interface SoundFont {
  samples: Sf2Sample[]
  presets: Sf2Preset[]
}

// generator operators we honour
const GEN = {
  startAddrsOffset: 0,
  instrument: 41,
  keyRange: 43,
  velRange: 44,
  sampleID: 53,
  sampleModes: 54,
  overridingRootKey: 58,
  coarseTune: 51,
  fineTune: 52,
  delayVolEnv: 33,
  attackVolEnv: 34,
  holdVolEnv: 35,
  decayVolEnv: 36,
  sustainVolEnv: 37,
  releaseVolEnv: 38,
  pan: 17,
  initialAttenuation: 48,
}

class Reader {
  private readonly dv: DataView
  pos = 0
  constructor(buf: ArrayBuffer) {
    this.dv = new DataView(buf)
  }
  u8(): number { return this.dv.getUint8(this.pos++) }
  u16(): number { const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v }
  s16(): number { const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v }
  u32(): number { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v }
  fourcc(): string {
    let s = ''
    for (let i = 0; i < 4; i++) s += String.fromCharCode(this.u8())
    return s
  }
  str(n: number): string {
    let s = ''
    for (let i = 0; i < n; i++) {
      const c = this.u8()
      if (c !== 0 && s.length === i) s += String.fromCharCode(c)
    }
    return s.replace(/\0.*$/, '').trim()
  }
  bytes(n: number): void { this.pos += n }
}

interface Chunk { id: string; start: number; size: number }

// list the sub-chunks inside a region [start, start+size)
function listChunks(r: Reader, start: number, size: number): Chunk[] {
  const out: Chunk[] = []
  let p = start
  const end = start + size
  while (p + 8 <= end) {
    r.pos = p
    const id = r.fourcc()
    const sz = r.u32()
    out.push({ id, start: r.pos, size: sz })
    p = r.pos + sz + (sz & 1) // chunks are word-aligned
  }
  return out
}

interface Gen { op: number; amount: number; lo: number; hi: number }
interface Bag { genNdx: number; modNdx: number }

function readGenerators(r: Reader, c: Chunk): Gen[] {
  const out: Gen[] = []
  const n = Math.floor(c.size / 4)
  r.pos = c.start
  for (let i = 0; i < n; i++) {
    const op = r.u16()
    const lo = r.u8()
    const hi = r.u8()
    r.pos -= 2
    const amount = r.s16()
    out.push({ op, amount, lo, hi })
  }
  return out
}

function readBags(r: Reader, c: Chunk): Bag[] {
  const out: Bag[] = []
  const n = Math.floor(c.size / 4)
  r.pos = c.start
  for (let i = 0; i < n; i++) out.push({ genNdx: r.u16(), modNdx: r.u16() })
  return out
}

const timecentsToSec = (tc: number): number => (tc <= -32000 ? 0 : Math.pow(2, tc / 1200))
const centibelToGain = (cb: number): number => Math.pow(10, -cb / 200)

// apply one generator into an accumulating zone spec
function applyGen(z: Partial<Sf2Zone> & { sampleModes?: number }, g: Gen): void {
  switch (g.op) {
    case GEN.keyRange: z.keyLo = g.lo; z.keyHi = g.hi; break
    case GEN.velRange: z.velLo = g.lo; z.velHi = g.hi; break
    case GEN.sampleID: z.sampleIndex = g.amount & 0xffff; break
    case GEN.overridingRootKey: if (g.amount >= 0) z.rootKey = g.amount; break
    case GEN.coarseTune: z.tuneCents = (z.tuneCents ?? 0) + g.amount * 100; break
    case GEN.fineTune: z.tuneCents = (z.tuneCents ?? 0) + g.amount; break
    case GEN.sampleModes: z.sampleModes = g.amount & 0x3; break
    case GEN.attackVolEnv: z.attack = timecentsToSec(g.amount); break
    case GEN.holdVolEnv: z.hold = timecentsToSec(g.amount); break
    case GEN.decayVolEnv: z.decay = timecentsToSec(g.amount); break
    case GEN.sustainVolEnv: z.sustain = centibelToGain(Math.max(0, g.amount)); break
    case GEN.releaseVolEnv: z.release = timecentsToSec(g.amount); break
    case GEN.pan: z.pan = Math.max(-1, Math.min(1, g.amount / 500)); break
    case GEN.initialAttenuation: z.gain = centibelToGain(Math.max(0, g.amount)); break
  }
}

export function parseSf2(buf: ArrayBuffer): SoundFont {
  const r = new Reader(buf)
  if (r.fourcc() !== 'RIFF') throw new Error('not a RIFF file')
  r.u32() // riff size
  if (r.fourcc() !== 'sfbk') throw new Error('not a SoundFont (sfbk)')

  const top = listChunks(r, r.pos, buf.byteLength - r.pos)
  const lists: Record<string, Chunk[]> = {}
  let smpl: Chunk | null = null
  for (const c of top) {
    if (c.id !== 'LIST') continue
    r.pos = c.start
    const listType = r.fourcc()
    const subs = listChunks(r, r.pos, c.size - 4)
    lists[listType] = subs
    if (listType === 'sdta') smpl = subs.find(s => s.id === 'smpl') ?? null
  }
  const pdta = lists['pdta']
  if (!pdta || !smpl) throw new Error('SoundFont missing sdta/pdta')

  // decode the 16-bit PCM sample pool once
  const pool = new Float32Array(Math.floor(smpl.size / 2))
  {
    const dv = new DataView(buf)
    for (let i = 0; i < pool.length; i++) pool[i] = dv.getInt16(smpl.start + i * 2, true) / 32768
  }

  const find = (id: string): Chunk => {
    const c = pdta.find(x => x.id === id)
    if (!c) throw new Error(`pdta missing ${id}`)
    return c
  }

  // sample headers
  const shdr = find('shdr')
  const samples: Sf2Sample[] = []
  {
    const n = Math.floor(shdr.size / 46) - 1 // last is terminal
    r.pos = shdr.start
    for (let i = 0; i < n; i++) {
      const name = r.str(20)
      const start = r.u32()
      const end = r.u32()
      const startLoop = r.u32()
      const endLoop = r.u32()
      const sampleRate = r.u32()
      const originalPitch = r.u8()
      const pitchCorrection = (r.u8() << 24) >> 24 // signed
      r.u16() // sampleLink
      r.u16() // sampleType
      samples.push({
        name,
        data: pool.slice(start, end),
        sampleRate: sampleRate || 44100,
        loopStart: Math.max(0, startLoop - start),
        loopEnd: Math.max(0, endLoop - start),
        originalPitch: originalPitch <= 127 ? originalPitch : 60,
        pitchCorrection,
      })
    }
  }

  const pgen = readGenerators(r, find('pgen'))
  const pbag = readBags(r, find('pbag'))
  const igen = readGenerators(r, find('igen'))
  const ibag = readBags(r, find('ibag'))

  // instruments → resolved instrument zones
  const inst = find('inst')
  interface Instrument { name: string; bagNdx: number }
  const instruments: Instrument[] = []
  {
    const n = Math.floor(inst.size / 22)
    r.pos = inst.start
    for (let i = 0; i < n; i++) instruments.push({ name: r.str(20), bagNdx: r.u16() })
  }

  const defaultZone = (): Sf2Zone => ({
    keyLo: 0, keyHi: 127, velLo: 0, velHi: 127, sampleIndex: -1, rootKey: 60, tuneCents: 0,
    loop: false, attack: 0.001, hold: 0, decay: 0, sustain: 1, release: 0.06, pan: 0, gain: 1,
  })

  // resolve one instrument's zones (bags [from,to)), honouring a leading global zone
  const instrumentZones = (instIndex: number): Sf2Zone[] => {
    const from = instruments[instIndex].bagNdx
    const to = instIndex + 1 < instruments.length ? instruments[instIndex + 1].bagNdx : ibag.length
    const zones: Sf2Zone[] = []
    let global: (Partial<Sf2Zone> & { sampleModes?: number }) | null = null
    for (let b = from; b < to; b++) {
      const gStart = ibag[b].genNdx
      const gEnd = b + 1 < ibag.length ? ibag[b + 1].genNdx : igen.length
      const spec: Partial<Sf2Zone> & { sampleModes?: number } = global ? { ...global } : {}
      for (let g = gStart; g < gEnd; g++) applyGen(spec, igen[g])
      if (spec.sampleIndex === undefined) {
        // a zone with no sample = the instrument's global zone (defaults)
        global = spec
        continue
      }
      const z = { ...defaultZone(), ...spec }
      const s = samples[spec.sampleIndex]
      if (z.rootKey === 60 && spec.rootKey === undefined && s) z.rootKey = s.originalPitch
      z.loop = (spec.sampleModes ?? 0) === 1 || (spec.sampleModes ?? 0) === 3
      zones.push(z)
    }
    return zones
  }

  // presets
  const phdr = find('phdr')
  const presets: Sf2Preset[] = []
  interface PHdr { name: string; program: number; bank: number; bagNdx: number }
  const phdrs: PHdr[] = []
  {
    const n = Math.floor(phdr.size / 38)
    r.pos = phdr.start
    for (let i = 0; i < n; i++) {
      const name = r.str(20)
      const program = r.u16()
      const bank = r.u16()
      const bagNdx = r.u16()
      r.u32(); r.u32(); r.u32()
      phdrs.push({ name, program, bank, bagNdx })
    }
  }
  for (let i = 0; i < phdrs.length - 1; i++) {
    const from = phdrs[i].bagNdx
    const to = phdrs[i + 1].bagNdx
    const zones: Sf2Zone[] = []
    for (let b = from; b < to; b++) {
      const gStart = pbag[b].genNdx
      const gEnd = b + 1 < pbag.length ? pbag[b + 1].genNdx : pgen.length
      let instIndex = -1
      let pKeyLo = 0, pKeyHi = 127, pVelLo = 0, pVelHi = 127
      for (let g = gStart; g < gEnd; g++) {
        const gen = pgen[g]
        if (gen.op === GEN.instrument) instIndex = gen.amount & 0xffff
        else if (gen.op === GEN.keyRange) { pKeyLo = gen.lo; pKeyHi = gen.hi }
        else if (gen.op === GEN.velRange) { pVelLo = gen.lo; pVelHi = gen.hi }
      }
      if (instIndex < 0 || instIndex >= instruments.length) continue
      // intersect preset-zone range with each instrument zone range
      for (const iz of instrumentZones(instIndex)) {
        zones.push({
          ...iz,
          keyLo: Math.max(iz.keyLo, pKeyLo),
          keyHi: Math.min(iz.keyHi, pKeyHi),
          velLo: Math.max(iz.velLo, pVelLo),
          velHi: Math.min(iz.velHi, pVelHi),
        })
      }
    }
    presets.push({ name: phdrs[i].name, bank: phdrs[i].bank, program: phdrs[i].program, zones })
  }

  return { samples, presets }
}

// pick the zones that should sound for a given note + velocity
export function zonesForNote(preset: Sf2Preset, pitch: number, vel: number): Sf2Zone[] {
  const v = Math.round(vel * 127)
  return preset.zones.filter(z => pitch >= z.keyLo && pitch <= z.keyHi && v >= z.velLo && v <= z.velHi)
}
