import { describe, expect, it } from 'vitest'
import { detectPitch } from './autotune'
import { extractStems } from './stems'

const RATE = 22050

// 4 seconds: percussive clicks every 0.5s + 80 Hz "bass" + 800 Hz "vocal" tone
function makeMix(): Float32Array[] {
  const n = RATE * 4
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const bass = Math.sin(2 * Math.PI * 80 * t) * 0.4
    const vox = Math.sin(2 * Math.PI * 800 * t) * 0.3
    L[i] = bass + vox
    R[i] = bass + vox
  }
  // broadband clicks (drums)
  for (let c = 0; c < 8; c++) {
    const at = Math.floor(c * 0.5 * RATE)
    for (let i = 0; i < 400; i++) {
      const burst = (Math.sin(i * 1.7) + Math.sin(i * 5.3) + Math.sin(i * 13.1)) * Math.exp(-i / 60) * 0.3
      L[at + i] += burst
      R[at + i] += burst
    }
  }
  return [L, R]
}

function energy(data: Float32Array, from: number, to: number): number {
  let s = 0
  const i0 = Math.floor(from * RATE)
  const i1 = Math.min(data.length, Math.floor(to * RATE))
  for (let i = i0; i < i1; i++) s += data[i] * data[i]
  return s / Math.max(1, i1 - i0)
}

describe('stem extraction', () => {
  it('separates drums, bass, and a center tone from a synthetic mix', async () => {
    const stems = await extractStems(makeMix(), RATE)
    const byName = Object.fromEntries(stems.map(s => [s.name, s]))

    // every stem produced finite audio
    for (const s of stems) {
      expect(Number.isFinite(s.rms)).toBe(true)
    }

    // drums stem: energy concentrated at the click instants
    const drums = byName.drums.channels[0]
    const atClick = energy(drums, 1.0, 1.02) // click at t=1.0
    const between = energy(drums, 1.2, 1.4)
    expect(atClick).toBeGreaterThan(between * 3)

    // bass stem: pitch tracks the 80 Hz tone
    const bass = byName.bass.channels[0]
    const bassPitch = detectPitch(bass, RATE, 4096, RATE)
    expect(Math.abs(bassPitch - 80)).toBeLessThan(6)

    // vocals stem keeps the 800 Hz center tone and sheds the bass
    const vox = byName.vocals.channels[0]
    const voxLow = bandEnergyRatio(vox)
    const bassLow = bandEnergyRatio(bass)
    expect(bassLow).toBeGreaterThan(0.7) // bass stem is mostly low band (one-pole split is a soft measure)
    expect(voxLow).toBeLessThan(0.4) // vocals stem is mostly NOT low band
  }, 30000)
})

// fraction of energy below ~150 Hz, via simple one-pole lowpass split
function bandEnergyRatio(data: Float32Array): number {
  const alpha = 1 - Math.exp((-2 * Math.PI * 150) / RATE)
  let lp = 0
  let low = 0
  let total = 0
  for (let i = RATE; i < data.length - RATE; i++) {
    lp += alpha * (data[i] - lp)
    low += lp * lp
    total += data[i] * data[i]
  }
  return total > 1e-12 ? low / total : 0
}
