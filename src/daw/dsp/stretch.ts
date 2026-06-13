// Pitch-preserving time-stretch (WSOLA). `factor` > 1 makes the audio LONGER
// (slower), < 1 shorter (faster); pitch is unchanged. Overlap-add of Hann
// grains whose input read position is re-aligned by cross-correlation so
// successive grains stay phase-coherent (no metallic doubling).
//
// Pure Float32Array math — node-testable, and reused for both live playback
// (pre-rendered buffer, cached) and offline bounce.

const GRAIN = 2048
const HS = GRAIN / 2 // synthesis hop (output)
const SEARCH = 256 // re-alignment search radius (samples)
const OVERLAP = GRAIN - HS // region that overlaps the previous grain

const HANN = new Float32Array(GRAIN)
for (let i = 0; i < GRAIN; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / GRAIN)

export function timeStretch(input: Float32Array, factor: number): Float32Array<ArrayBuffer> {
  if (input.length < GRAIN * 2 || Math.abs(factor - 1) < 1e-4) return input.slice() as Float32Array<ArrayBuffer>
  const ha = HS / factor // input advance per output hop
  const outLen = Math.max(GRAIN, Math.round(input.length * factor))
  const out = new Float32Array(outLen + GRAIN)
  const norm = new Float32Array(outLen + GRAIN)

  let ana = 0 // float input read position
  let syn = 0 // output write position
  // the input samples we last overlapped — the next grain is aligned to match
  let tail: Float32Array | null = null

  while (syn + GRAIN < out.length) {
    let read = Math.floor(ana)
    if (tail) read = bestAlign(input, tail, Math.floor(ana))
    if (read + GRAIN >= input.length) break

    for (let i = 0; i < GRAIN; i++) {
      out[syn + i] += input[read + i] * HANN[i]
      norm[syn + i] += HANN[i]
    }
    // remember the segment the NEXT grain will overlap (input[read+HS .. +GRAIN])
    tail = input.subarray(read + HS, read + HS + OVERLAP)
    ana += ha
    syn += HS
  }

  // trim to the intended length and de-window
  const result = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) result[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0
  return result
}

// position near `anchor` whose `OVERLAP` samples best match `tail`
function bestAlign(input: Float32Array, tail: Float32Array, anchor: number): number {
  const n = tail.length
  const from = Math.max(0, anchor - SEARCH)
  const to = Math.min(input.length - n - 1, anchor + SEARCH)
  let best = -Infinity
  let bestPos = Math.max(0, Math.min(anchor, input.length - n - 1))
  for (let cand = from; cand <= to; cand++) {
    let num = 0
    let den = 0
    for (let i = 0; i < n; i += 2) {
      // stride 2 — plenty for alignment, halves the work
      const a = tail[i]
      const b = input[cand + i]
      num += a * b
      den += b * b
    }
    const score = num / Math.sqrt(den + 1e-9)
    if (score > best) {
      best = score
      bestPos = cand
    }
  }
  return bestPos
}
