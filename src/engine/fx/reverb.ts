import { BaseFx } from './base'

const MAX_SIZE = 4 // seconds
const REGEN_DEBOUNCE_MS = 150

export class Reverb extends BaseFx {
  readonly id = 'reverb' as const
  private readonly convolver: ConvolverNode
  private size: number
  private decay: number
  private regenTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: BaseAudioContext, cfg: { size: number; decay: number; mix: number }) {
    super(ctx, cfg.mix, 'send')
    this.size = cfg.size
    this.decay = cfg.decay
    this.convolver = ctx.createConvolver()
    this.convolver.buffer = makeImpulse(ctx, this.size, this.decay)
    this.wetIn.connect(this.convolver)
    this.convolver.connect(this.wet)
  }

  protected applyOwn(key: string, value: number, _t: number): void {
    if (key === 'size') this.size = Math.min(MAX_SIZE, Math.max(0.1, value))
    else if (key === 'decay') this.decay = value
    else return
    // IR generation is the most expensive thing in the engine; debounce drags.
    if (this.regenTimer !== null) clearTimeout(this.regenTimer)
    this.regenTimer = setTimeout(() => {
      this.convolver.buffer = makeImpulse(this.ctx, this.size, this.decay)
    }, REGEN_DEBOUNCE_MS)
  }

  override dispose(): void {
    if (this.regenTimer !== null) clearTimeout(this.regenTimer)
    super.dispose()
  }
}

// Generated stereo impulse response: decaying noise with slight L/R
// decorrelation and a darkening tilt. Zero network, instantly tweakable.
function makeImpulse(ctx: BaseAudioContext, size: number, decay: number): AudioBuffer {
  const len = Math.max(64, Math.floor(ctx.sampleRate * size))
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  // decay 0..1 → tail shape exponent: higher decay = longer, denser tail
  const exponent = 1 + (1 - decay) * 5
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    let lp = 0
    // simple one-pole lowpass in the generation loop for high-end damping
    const damp = 0.25 + decay * 0.35
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, exponent)
      const white = Math.random() * 2 - 1
      lp += damp * (white - lp)
      data[i] = lp * env
    }
  }
  return buf
}
