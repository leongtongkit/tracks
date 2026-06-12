// MP3 export via lamejs — shareable bounce sizes (a 3-minute song lands
// around 4 MB instead of a 30 MB WAV).

import { Mp3Encoder } from '@breezystack/lamejs'

const BLOCK = 1152

export function encodeMp3(buffer: AudioBuffer, kbps = 192): Blob {
  const channels = buffer.numberOfChannels > 1 ? 2 : 1
  const enc = new Mp3Encoder(channels, buffer.sampleRate, kbps)
  const left = toInt16(buffer.getChannelData(0))
  const right = channels === 2 ? toInt16(buffer.getChannelData(1)) : left
  const chunks: Uint8Array[] = []
  for (let i = 0; i < left.length; i += BLOCK) {
    const out =
      channels === 2
        ? enc.encodeBuffer(left.subarray(i, i + BLOCK), right.subarray(i, i + BLOCK))
        : enc.encodeBuffer(left.subarray(i, i + BLOCK))
    if (out.length > 0) chunks.push(out)
  }
  const tail = enc.flush()
  if (tail.length > 0) chunks.push(tail)
  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' })
}

function toInt16(data: Float32Array): Int16Array {
  const out = new Int16Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(-1, Math.min(1, data[i]))
    out[i] = Math.round(v < 0 ? v * 0x8000 : v * 0x7fff)
  }
  return out
}
