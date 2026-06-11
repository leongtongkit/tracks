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

function toPcm16(v: number): number {
  const clamped = Math.max(-1, Math.min(1, v))
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff)
}

function writeAscii(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
}
