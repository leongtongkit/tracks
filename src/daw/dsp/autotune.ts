// Pitch correction (autotune) and small audio-clip DSP utilities.
// Everything here is pure Float32Array math — no Web Audio — so the whole
// pipeline is unit-testable in node.
//
// Pipeline: NSDF pitch tracking on a 4x-decimated copy → snap each frame's
// pitch to the project key/scale with a one-pole "retune speed" smoother →
// granular overlap-add resynthesis with a per-grain pitch ratio.

export interface AutotuneOpts {
  root: number // 0..11, 0 = C
  scale: 'chromatic' | 'major' | 'minor'
  retuneMs: number // 5 = hard T-Pain snap, 200 = gentle correction
  amount: number // 0..1, how far toward the snapped pitch
}

const DECIM = 4
const HOP = 512 // analysis hop in input samples
const FRAME = 1024 // analysis window in input samples
const GRAIN = 2048
const GHOP = GRAIN / 2

const SCALES: Record<AutotuneOpts['scale'], number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
}

// Nearest scale tone to a (fractional) MIDI pitch.
export function snapToScale(midi: number, root: number, scale: AutotuneOpts['scale']): number {
  const tones = SCALES[scale]
  let best = 0
  let bestDist = Infinity
  for (let oct = -1; oct <= 1; oct++) {
    for (const tone of tones) {
      const candidate = (Math.floor((midi - root) / 12) + oct) * 12 + root + tone
      const dist = Math.abs(candidate - midi)
      if (dist < bestDist) {
        bestDist = dist
        best = candidate
      }
    }
  }
  return best
}

// Normalized square-difference pitch detector (McLeod-style) over one window.
// Returns f0 in Hz, or 0 when unvoiced/uncertain.
export function detectPitch(data: Float32Array, start: number, len: number, rate: number): number {
  const minF = 70
  const maxF = 800
  const maxLag = Math.min(Math.floor(rate / minF), Math.floor((data.length - start - len)))
  const minLag = Math.floor(rate / maxF)
  if (maxLag <= minLag || start < 0) return 0

  const nsdf = new Float32Array(maxLag + 1)
  let best = 0
  let bestLag = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0
    let den = 0
    for (let i = 0; i < len; i++) {
      const a = data[start + i]
      const b = data[start + i + lag]
      num += a * b
      den += a * a + b * b
    }
    nsdf[lag] = den > 1e-9 ? (2 * num) / den : 0
    if (nsdf[lag] > best) {
      best = nsdf[lag]
      bestLag = lag
    }
  }
  if (best < 0.6 || bestLag === 0) return 0
  // every multiple of the true period correlates ~equally; take the FIRST
  // peak near the global max (else the detector drops octaves), refined
  // parabolically for sub-lag precision
  const thresh = 0.9 * best
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (nsdf[lag] >= thresh && nsdf[lag] >= nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1]) {
      const denom = 2 * (2 * nsdf[lag] - nsdf[lag - 1] - nsdf[lag + 1])
      const d = Math.abs(denom) > 1e-12 ? (nsdf[lag + 1] - nsdf[lag - 1]) / denom : 0
      return rate / (lag + Math.max(-0.5, Math.min(0.5, d)))
    }
  }
  return rate / bestLag
}

const midiOf = (f: number): number => 69 + 12 * Math.log2(f / 440)

// Per-HOP pitch-shift ratios for the whole signal.
function trackRatios(input: Float32Array, rate: number, opts: AutotuneOpts): Float32Array {
  // decimate for cheap detection (vocals sit far below the decimated Nyquist)
  const dLen = Math.floor(input.length / DECIM)
  const dec = new Float32Array(dLen)
  for (let i = 0; i < dLen; i++) {
    // tiny box filter to tame aliasing
    const j = i * DECIM
    dec[i] = (input[j] + input[j + 1] + input[j + 2] + input[j + 3]) * 0.25
  }
  const dRate = rate / DECIM
  const dHop = HOP / DECIM
  const dFrame = FRAME / DECIM

  const frames = Math.max(1, Math.ceil(input.length / HOP))
  const ratios = new Float32Array(frames)
  const tau = Math.max(0.001, opts.retuneMs / 1000)
  const alpha = 1 - Math.exp(-(HOP / rate) / tau)
  let smoothed = 0
  let haveVoice = false

  for (let k = 0; k < frames; k++) {
    const f0 = detectPitch(dec, k * dHop, dFrame, dRate)
    if (f0 > 0) {
      const midi = midiOf(f0)
      const target = snapToScale(midi, opts.root, opts.scale)
      if (!haveVoice) {
        smoothed = target
        haveVoice = true
      } else {
        smoothed += (target - smoothed) * alpha
      }
      const shift = (smoothed - midi) * opts.amount
      ratios[k] = Math.min(2, Math.max(0.5, Math.pow(2, shift / 12)))
    } else {
      // unvoiced: relax toward no shift
      ratios[k] = k > 0 ? 1 + (ratios[k - 1] - 1) * 0.85 : 1
      haveVoice = false
    }
  }
  return ratios
}

const MAX_DRIFT = 1024 // samples the read head may stray from the timeline
const SEARCH_W = 700 // re-anchor search radius (covers > 1 period of 70 Hz)
const CORR_N = 280

// Phase-continuous granular pitch shifter (WSOLA-flavored). Each grain reads
// where the previous grain's resampled trajectory left off, so overlapping
// grains stay phase-aligned and the shift ratio is realized exactly; when the
// read head drifts too far from the timeline it snaps back to the
// best-correlated spot near the anchor (an integer number of periods away on
// periodic material, so the splice is inaudible).
export function autotuneChannel(input: Float32Array, rate: number, opts: AutotuneOpts): Float32Array {
  if (input.length < FRAME * 2) return input.slice()
  const ratios = trackRatios(input, rate, opts)
  const out = new Float32Array(input.length)

  let srcPrev = 0
  let ratioPrev = 1
  for (let pos = 0; pos < input.length; pos += GHOP) {
    const ratio = ratios[Math.min(ratios.length - 1, Math.floor(pos / HOP))]
    let src: number
    if (pos === 0) {
      src = 0
    } else {
      src = srcPrev + GHOP * ratioPrev
      if (Math.abs(src - pos) > MAX_DRIFT) {
        src = bestMatch(input, Math.floor(src), pos)
      }
    }
    for (let i = 0; i < GRAIN; i++) {
      const oi = pos + i
      if (oi >= out.length) break
      const srcPos = src + i * ratio
      const s0 = Math.floor(srcPos)
      if (s0 + 1 >= input.length || s0 < 0) break
      const frac = srcPos - s0
      const v = input[s0] * (1 - frac) + input[s0 + 1] * frac
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / GRAIN)
      out[oi] += w * v
    }
    srcPrev = src
    ratioPrev = ratio
  }
  return out
}

// position near `anchor` whose waveform best matches input at `template`
function bestMatch(input: Float32Array, template: number, anchor: number): number {
  const t0 = Math.max(0, Math.min(input.length - CORR_N - 1, template))
  let best = -Infinity
  let bestPos = anchor
  const from = Math.max(0, anchor - SEARCH_W)
  const to = Math.min(input.length - CORR_N - 1, anchor + SEARCH_W)
  for (let cand = from; cand <= to; cand++) {
    let num = 0
    let da = 0
    let db = 0
    for (let i = 0; i < CORR_N; i++) {
      const a = input[t0 + i]
      const b = input[cand + i]
      num += a * b
      da += a * a
      db += b * b
    }
    const c = num / Math.sqrt(da * db + 1e-12)
    if (c > best) {
      best = c
      bestPos = cand
    }
  }
  return bestPos
}

// ---------- small clip utilities (also pure) ----------

export function normalizeChannels(channels: Float32Array[], target = 0.98): void {
  let peak = 0
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i])
      if (a > peak) peak = a
    }
  }
  if (peak < 1e-6) return
  const g = target / peak
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) ch[i] *= g
  }
}

export function reverseChannels(channels: Float32Array[]): void {
  for (const ch of channels) ch.reverse()
}
