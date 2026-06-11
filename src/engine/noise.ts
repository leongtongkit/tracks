// One shared white-noise buffer per context; voices loop it from random offsets.

const cache = new WeakMap<BaseAudioContext, AudioBuffer>()

export function getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = cache.get(ctx)
  if (!buf) {
    const length = ctx.sampleRate * 2
    buf = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    cache.set(ctx, buf)
  }
  return buf
}
