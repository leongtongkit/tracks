// Transient (onset) detection for slicing: short-window energy flux with a
// rolling threshold and a minimum gap. Pure Float32Array math, node-testable.

const WIN = 256 // analysis hop (≈5.8ms at 44.1k)
const MIN_GAP_S = 0.05

// Returns onset positions as sample indices, strongest-first capped at `max`,
// then re-sorted by time. Always includes 0 (the first slice starts at the top).
export function detectOnsets(data: Float32Array, rate: number, max = 16): number[] {
  const frames = Math.floor(data.length / WIN)
  if (frames < 4) return [0]

  // frame energies
  const energy = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let s = 0
    const base = f * WIN
    for (let i = 0; i < WIN; i++) s += data[base + i] * data[base + i]
    energy[f] = s / WIN
  }

  // positive energy flux against a short trailing average (so decaying tails
  // don't retrigger), normalized by local level
  const candidates: { at: number; strength: number }[] = []
  const TRAIL = 6
  for (let f = TRAIL; f < frames; f++) {
    let avg = 0
    for (let k = 1; k <= TRAIL; k++) avg += energy[f - k]
    avg /= TRAIL
    const flux = energy[f] - avg
    if (flux > avg * 2 + 1e-6) {
      candidates.push({ at: f * WIN, strength: flux })
    }
  }

  // strongest-first, enforcing the minimum gap
  candidates.sort((a, b) => b.strength - a.strength)
  const minGap = Math.floor(rate * MIN_GAP_S)
  const picked: number[] = []
  for (const c of candidates) {
    if (picked.length >= max) break
    if (picked.every(p => Math.abs(p - c.at) >= minGap)) picked.push(c.at)
  }
  if (!picked.some(p => p < minGap)) picked.push(0)
  return picked.sort((a, b) => a - b).slice(0, max)
}
