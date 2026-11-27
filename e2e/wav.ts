// Minimal RIFF/WAVE reader for the files the app exports (PCM 16-bit or 32-bit float).

export interface WavInfo {
  format: number // 1 = PCM, 3 = IEEE float
  channels: number
  sampleRate: number
  bitsPerSample: number
  frames: number
  seconds: number
  /** largest absolute sample value, 0..1 */
  peak: number
  /** loudest sample in each half second (both channels), 0..1 */
  halfSecondPeaks: number[]
}

export function parseWav(buf: Buffer): WavInfo {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file')
  }
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null
  let data: { offset: number; size: number } | null = null
  let pos = 12
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    const body = pos + 8
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      data = { offset: body, size: Math.min(size, buf.length - body) }
      break
    }
    pos = body + size + (size % 2)
  }
  if (!fmt) throw new Error('no fmt chunk')
  if (!data) throw new Error('no data chunk')

  const bytes = fmt.bits / 8
  const frames = Math.floor(data.size / (bytes * fmt.channels))
  let peak = 0
  const window = Math.round(fmt.sampleRate / 2)
  const halfSecondPeaks: number[] = new Array(Math.ceil(frames / window)).fill(0)
  for (let i = 0; i < frames * fmt.channels; i++) {
    const at = data.offset + i * bytes
    let v: number
    if (fmt.format === 3 && fmt.bits === 32) v = buf.readFloatLE(at)
    else if (fmt.format === 1 && fmt.bits === 16) v = buf.readInt16LE(at) / 32768
    else throw new Error(`unsupported wav format ${fmt.format}/${fmt.bits}`)
    const a = Math.abs(v)
    if (a > peak) peak = a
    const w = Math.floor(i / fmt.channels / window)
    if (a > halfSecondPeaks[w]) halfSecondPeaks[w] = a
  }
  return {
    format: fmt.format,
    channels: fmt.channels,
    sampleRate: fmt.sampleRate,
    bitsPerSample: fmt.bits,
    frames,
    seconds: frames / fmt.sampleRate,
    peak,
    halfSecondPeaks,
  }
}
