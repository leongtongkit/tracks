// Analytic magnitude response of the parametric EQ, used to draw the editor
// curve without running audio. RBJ biquad cookbook coefficients evaluated at
// |H(e^jw)|. Pure Float32 math → node-testable. (Shelves use Q≈0.7 which lines
// up with Web Audio's fixed-slope shelves, so the drawn curve tracks the sound.)

import { eqUsesGain, type EqBand } from '../project'

interface Coeffs {
  b0: number
  b1: number
  b2: number
  a0: number
  a1: number
  a2: number
}

function bandCoeffs(band: EqBand, fs: number): Coeffs {
  const w0 = (2 * Math.PI * Math.min(fs / 2 - 1, Math.max(20, band.freq))) / fs
  const cw = Math.cos(w0)
  const sw = Math.sin(w0)
  const q = Math.max(0.1, band.q)
  const alpha = sw / (2 * q)
  const A = Math.pow(10, (eqUsesGain(band.type) ? band.gain : 0) / 40)
  const sqA = Math.sqrt(A)
  switch (band.type) {
    case 'peaking':
      return { b0: 1 + alpha * A, b1: -2 * cw, b2: 1 - alpha * A, a0: 1 + alpha / A, a1: -2 * cw, a2: 1 - alpha / A }
    case 'lowshelf':
      return {
        b0: A * (A + 1 - (A - 1) * cw + 2 * sqA * alpha),
        b1: 2 * A * (A - 1 - (A + 1) * cw),
        b2: A * (A + 1 - (A - 1) * cw - 2 * sqA * alpha),
        a0: A + 1 + (A - 1) * cw + 2 * sqA * alpha,
        a1: -2 * (A - 1 + (A + 1) * cw),
        a2: A + 1 + (A - 1) * cw - 2 * sqA * alpha,
      }
    case 'highshelf':
      return {
        b0: A * (A + 1 + (A - 1) * cw + 2 * sqA * alpha),
        b1: -2 * A * (A - 1 + (A + 1) * cw),
        b2: A * (A + 1 + (A - 1) * cw - 2 * sqA * alpha),
        a0: A + 1 - (A - 1) * cw + 2 * sqA * alpha,
        a1: 2 * (A - 1 - (A + 1) * cw),
        a2: A + 1 - (A - 1) * cw - 2 * sqA * alpha,
      }
    case 'lowpass':
      return { b0: (1 - cw) / 2, b1: 1 - cw, b2: (1 - cw) / 2, a0: 1 + alpha, a1: -2 * cw, a2: 1 - alpha }
    case 'highpass':
      return { b0: (1 + cw) / 2, b1: -(1 + cw), b2: (1 + cw) / 2, a0: 1 + alpha, a1: -2 * cw, a2: 1 - alpha }
  }
}

// magnitude in dB of one band at frequency f (Hz)
export function bandDb(band: EqBand, f: number, fs: number): number {
  if (!band.on) return 0
  const c = bandCoeffs(band, fs)
  const w = (2 * Math.PI * f) / fs
  const cw = Math.cos(w)
  const sw = Math.sin(w)
  const c2 = Math.cos(2 * w)
  const s2 = Math.sin(2 * w)
  const numRe = c.b0 + c.b1 * cw + c.b2 * c2
  const numIm = -(c.b1 * sw + c.b2 * s2)
  const denRe = c.a0 + c.a1 * cw + c.a2 * c2
  const denIm = -(c.a1 * sw + c.a2 * s2)
  const num = Math.hypot(numRe, numIm)
  const den = Math.hypot(denRe, denIm) || 1e-9
  return 20 * Math.log10(num / den)
}

// Summed dB response of the whole band stack at each frequency.
export function eqResponseDb(bands: EqBand[], freqs: Float32Array | number[], fs = 44100): Float32Array {
  const out = new Float32Array(freqs.length)
  for (let i = 0; i < freqs.length; i++) {
    let db = 0
    for (const b of bands) db += bandDb(b, freqs[i], fs)
    out[i] = db
  }
  return out
}

// log-spaced frequency axis from 20 Hz to 20 kHz (n points)
export function logFreqs(n: number, lo = 20, hi = 20000): Float32Array {
  const out = new Float32Array(n)
  const r = Math.log(hi / lo)
  for (let i = 0; i < n; i++) out[i] = lo * Math.exp((r * i) / (n - 1))
  return out
}
