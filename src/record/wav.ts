// Minimal 16-bit PCM stereo WAV encoder.

export function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): ArrayBuffer {
  const frames = Math.min(left.length, right.length)
  const dataBytes = frames * 2 * 2 // stereo, 16-bit
  const buf = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buf)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 2, true) // channels
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 4, true) // byte rate
  view.setUint16(32, 4, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = 44
  for (let i = 0; i < frames; i++) {
    view.setInt16(offset, toPcm16(left[i]), true)
    view.setInt16(offset + 2, toPcm16(right[i]), true)
    offset += 4
  }
  return buf
}

// Decode the 16-bit PCM stereo WAVs this module writes (used when importing
// project files with embedded samples — no AudioContext needed).
export function decodeWav(buf: ArrayBuffer): { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer>; sampleRate: number } {
  const view = new DataView(buf)
  if (view.getUint32(0, false) !== 0x52494646 /* RIFF */) throw new Error('not a wav')
  const channels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const bits = view.getUint16(34, true)
  if (bits !== 16 || channels < 1 || channels > 2) throw new Error('unsupported wav')
  // find the data chunk (44 in our own files, but scan to be safe)
  let off = 12
  while (off + 8 <= view.byteLength) {
    const id = view.getUint32(off, false)
    const size = view.getUint32(off + 4, true)
    if (id === 0x64617461 /* data */) {
      const frames = Math.floor(size / (2 * channels))
      const left = new Float32Array(frames)
      const right = new Float32Array(frames)
      let p = off + 8
      for (let i = 0; i < frames; i++) {
        left[i] = view.getInt16(p, true) / 0x8000
        right[i] = channels === 2 ? view.getInt16(p + 2, true) / 0x8000 : left[i]
        p += 2 * channels
      }
      return { left, right, sampleRate }
    }
    off += 8 + size + (size % 2)
  }
  throw new Error('wav has no data chunk')
}

function toPcm16(v: number): number {
  const clamped = Math.max(-1, Math.min(1, v))
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff)
}

function writeAscii(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
}
