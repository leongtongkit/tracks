// Source separation ("extract vocals / drums / bass / other") in pure TS.
//
// Method: STFT → harmonic/percussive separation by median filtering
// (harmonic energy is stable across TIME, percussive energy is broadband
// across FREQUENCY — Fitzgerald 2010), soft Wiener-style masks, plus a
// stereo center-coherence mask for vocals (lead vocals are mixed center).
//
//   drums  = percussive mask
//   bass   = harmonic mask, bins below 160 Hz
//   vocals = harmonic mask × center coherence² × 120 Hz–9 kHz band
//   other  = what's left (mask residual, floored at 0)
//
// Two passes keep memory flat: pass 1 stores magnitudes only and builds the
// median-filtered H/P matrices; pass 2 re-runs the STFT per frame, applies
// the masks, and overlap-adds straight into the four output buffers.

const FRAME = 2048
const HOP = 512
const MED = 9 // median window (frames for H, bins for P)
const BASS_HZ = 160
const VOX_LO_HZ = 120
const VOX_HI_HZ = 9000

export type StemName = 'vocals' | 'drums' | 'bass' | 'other'

export interface StemResult {
  name: StemName
  channels: Float32Array<ArrayBuffer>[]
  rms: number
}

// ---------- FFT (iterative radix-2, in-place) ----------

const BITS = Math.log2(FRAME)
const REV = new Uint16Array(FRAME)
for (let i = 0; i < FRAME; i++) {
  let r = 0
  for (let b = 0; b < BITS; b++) r |= ((i >> b) & 1) << (BITS - 1 - b)
  REV[i] = r
}
const COS = new Float32Array(FRAME / 2)
const SIN = new Float32Array(FRAME / 2)
for (let i = 0; i < FRAME / 2; i++) {
  COS[i] = Math.cos((-2 * Math.PI * i) / FRAME)
  SIN[i] = Math.sin((-2 * Math.PI * i) / FRAME)
}

function fft(re: Float32Array, im: Float32Array, inverse: boolean): void {
  for (let i = 0; i < FRAME; i++) {
    const j = REV[i]
    if (j > i) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  const sign = inverse ? -1 : 1
  for (let size = 2; size <= FRAME; size <<= 1) {
    const half = size >> 1
    const step = FRAME / size
    for (let i = 0; i < FRAME; i += size) {
      for (let j = i, k = 0; j < i + half; j++, k += step) {
        const c = COS[k]
        const s = sign * SIN[k]
        const tr = re[j + half] * c - im[j + half] * s
        const ti = re[j + half] * s + im[j + half] * c
        re[j + half] = re[j] - tr
        im[j + half] = im[j] - ti
        re[j] += tr
        im[j] += ti
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < FRAME; i++) {
      re[i] /= FRAME
      im[i] /= FRAME
    }
  }
}

const HANN = new Float32Array(FRAME)
for (let i = 0; i < FRAME; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME)

function median9(values: Float32Array): number {
  const a = Array.from(values).sort((x, y) => x - y)
  return a[a.length >> 1]
}

// ---------- main ----------

export async function extractStems(
  input: Float32Array[],
  rate: number,
  onProgress?: (frac: number) => void,
): Promise<StemResult[]> {
  const left = input[0]
  const right = input.length > 1 ? input[1] : input[0]
  const len = left.length
  const frames = Math.max(1, Math.ceil(len / HOP))
  const bins = FRAME / 2 + 1

  // ---- pass 1: magnitude matrix of the mid signal ----
  const mag: Float32Array[] = new Array(frames)
  {
    const re = new Float32Array(FRAME)
    const im = new Float32Array(FRAME)
    for (let f = 0; f < frames; f++) {
      const start = f * HOP
      for (let i = 0; i < FRAME; i++) {
        const idx = start + i
        const v = idx < len ? (left[idx] + right[idx]) * 0.5 : 0
        re[i] = v * HANN[i]
        im[i] = 0
      }
      fft(re, im, false)
      const m = new Float32Array(bins)
      for (let k = 0; k < bins; k++) m[k] = Math.hypot(re[k], im[k])
      mag[f] = m
      if (f % 128 === 0) {
        onProgress?.((f / frames) * 0.35)
        await yieldUI()
      }
    }
  }

  // ---- median filters: H (stable over time), P (broadband over frequency) ----
  const H: Float32Array[] = new Array(frames)
  const P: Float32Array[] = new Array(frames)
  const winT = new Float32Array(MED)
  const winF = new Float32Array(MED)
  const halfMed = MED >> 1
  for (let f = 0; f < frames; f++) {
    const h = new Float32Array(bins)
    const p = new Float32Array(bins)
    for (let k = 0; k < bins; k++) {
      for (let w = 0; w < MED; w++) {
        const ft = Math.min(frames - 1, Math.max(0, f + w - halfMed))
        winT[w] = mag[ft][k]
        const kf = Math.min(bins - 1, Math.max(0, k + w - halfMed))
        winF[w] = mag[f][kf]
      }
      h[k] = median9(winT)
      p[k] = median9(winF)
    }
    H[f] = h
    P[f] = p
    if (f % 64 === 0) {
      onProgress?.(0.35 + (f / frames) * 0.25)
      await yieldUI()
    }
  }

  // ---- pass 2: masked resynthesis straight into the stems ----
  const names: StemName[] = ['vocals', 'drums', 'bass', 'other']
  const stems = names.map(() => [new Float32Array(len), new Float32Array(len)])
  const norm = new Float32Array(len) // hann overlap normalization

  const bassBin = Math.round((BASS_HZ / rate) * FRAME)
  const voxLo = Math.round((VOX_LO_HZ / rate) * FRAME)
  const voxHi = Math.round((VOX_HI_HZ / rate) * FRAME)

  const reL = new Float32Array(FRAME)
  const imL = new Float32Array(FRAME)
  const reR = new Float32Array(FRAME)
  const imR = new Float32Array(FRAME)
  const masks = new Float32Array(bins * 4)
  const wr = new Float32Array(FRAME)
  const wi = new Float32Array(FRAME)

  for (let f = 0; f < frames; f++) {
    const start = f * HOP
    for (let i = 0; i < FRAME; i++) {
      const idx = start + i
      reL[i] = idx < len ? left[idx] * HANN[i] : 0
      imL[i] = 0
      reR[i] = idx < len ? right[idx] * HANN[i] : 0
      imR[i] = 0
    }
    fft(reL, imL, false)
    fft(reR, imR, false)

    const h = H[f]
    const p = P[f]
    for (let k = 0; k < bins; k++) {
      const hh = h[k] * h[k]
      const pp = p[k] * p[k]
      const denom = hh + pp + 1e-12
      const mh = hh / denom
      const mp = pp / denom
      // stereo center coherence: 1 when L and R agree (center-mixed)
      const lMag2 = reL[k] * reL[k] + imL[k] * imL[k]
      const rMag2 = reR[k] * reR[k] + imR[k] * imR[k]
      const cross = Math.hypot(reL[k] * reR[k] + imL[k] * imR[k], imL[k] * reR[k] - reL[k] * imR[k])
      const sim = (2 * cross) / (lMag2 + rMag2 + 1e-12)
      const vox = k >= voxLo && k <= voxHi ? mh * sim * sim : 0
      const bass = k < bassBin ? mh * (1 - sim * sim * 0.5) : 0 // keep center bass too; mostly low bins
      const drums = mp
      const other = Math.max(0, 1 - drums - vox - bass)
      masks[k * 4] = vox
      masks[k * 4 + 1] = drums
      masks[k * 4 + 2] = bass
      masks[k * 4 + 3] = other
    }

    for (let s = 0; s < 4; s++) {
      for (let ch = 0; ch < 2; ch++) {
        const re = ch === 0 ? reL : reR
        const im = ch === 0 ? imL : imR
        for (let k = 0; k < bins; k++) {
          const m = masks[k * 4 + s]
          wr[k] = re[k] * m
          wi[k] = im[k] * m
          if (k > 0 && k < FRAME / 2) {
            // hermitian symmetry keeps the inverse real
            wr[FRAME - k] = wr[k]
            wi[FRAME - k] = -wi[k]
          }
        }
        wi[0] = 0
        wi[FRAME / 2] = 0
        fft(wr, wi, true)
        const out = stems[s][ch]
        for (let i = 0; i < FRAME; i++) {
          const idx = start + i
          if (idx >= len) break
          out[idx] += wr[i] * HANN[i]
        }
      }
    }
    for (let i = 0; i < FRAME; i++) {
      const idx = start + i
      if (idx >= len) break
      norm[idx] += HANN[i] * HANN[i]
    }
    if (f % 32 === 0) {
      onProgress?.(0.6 + (f / frames) * 0.4)
      await yieldUI()
    }
  }

  for (const stem of stems) {
    for (const ch of stem) {
      for (let i = 0; i < len; i++) {
        if (norm[i] > 1e-6) ch[i] /= norm[i]
      }
    }
  }

  onProgress?.(1)
  return names.map((name, s) => {
    let sum = 0
    for (const v of stems[s][0]) sum += v * v
    return { name, channels: stems[s], rms: Math.sqrt(sum / len) }
  })
}

function yieldUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
