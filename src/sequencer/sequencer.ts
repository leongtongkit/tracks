// 16-step sequencer on the classic two-clock pattern: a coarse JS interval
// pumps a scheduler that books note events a short window ahead on the
// sample-accurate audio clock, so timing never drifts with main-thread jank.

export interface Step {
  on: boolean
  semi: number // semitones above the base note (0..24)
}

export interface SeqEvents {
  noteOn(note: number, t: number): void
  noteOff(note: number, t: number): void
  onStep?(index: number, t: number): void
}

export const STEP_COUNT = 16
const LOOKAHEAD_S = 0.12
const TICK_MS = 25
const GATE = 0.5 // fraction of the step the note is held

const STORAGE_KEY = 'synth.seq.v1'

// A friendly default: minor arp up and back, instantly musical on any preset.
const DEFAULT_SEMIS = [0, 3, 7, 10, 12, 10, 7, 3, 0, 3, 7, 10, 12, 15, 12, 10]

export class Sequencer {
  readonly steps: Step[] = DEFAULT_SEMIS.map(semi => ({ on: true, semi }))
  playing = false
  // UI playhead hook: fired per booked step with the ms until it sounds.
  onStepUI: ((index: number, waitMs: number) => void) | null = null

  private timer: ReturnType<typeof setInterval> | null = null
  private nextStepTime = 0
  private stepIndex = 0
  private readonly events: SeqEvents
  private readonly getNow: () => number
  private readonly getBpm: () => number
  private readonly getBaseNote: () => number

  constructor(opts: {
    events: SeqEvents
    getNow: () => number
    getBpm: () => number
    getBaseNote: () => number
  }) {
    this.events = opts.events
    this.getNow = opts.getNow
    this.getBpm = opts.getBpm
    this.getBaseNote = opts.getBaseNote
    this.restore()
  }

  get stepDuration(): number {
    return 60 / this.getBpm() / 4 // 16th notes
  }

  start(): void {
    if (this.playing) return
    this.playing = true
    this.stepIndex = 0
    this.nextStepTime = this.getNow() + 0.06
    this.timer = setInterval(() => this.pump(), TICK_MS)
    this.pump()
  }

  stop(): void {
    this.playing = false
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  toggle(): boolean {
    if (this.playing) this.stop()
    else this.start()
    return this.playing
  }

  setStep(i: number, step: Partial<Step>): void {
    Object.assign(this.steps[i], step)
    this.persist()
  }

  clear(): void {
    for (const s of this.steps) s.on = false
    this.persist()
  }

  // Books every step due inside the lookahead window. Public for tests.
  pump(now = this.getNow()): { index: number; time: number }[] {
    const booked: { index: number; time: number }[] = []
    while (this.nextStepTime < now + LOOKAHEAD_S) {
      const step = this.steps[this.stepIndex]
      const t = this.nextStepTime
      const dur = this.stepDuration
      if (step.on) {
        const note = this.getBaseNote() + step.semi
        this.events.noteOn(note, t)
        this.events.noteOff(note, t + dur * GATE)
      }
      this.events.onStep?.(this.stepIndex, t)
      this.onStepUI?.(this.stepIndex, Math.max(0, (t - now) * 1000))
      booked.push({ index: this.stepIndex, time: t })
      this.stepIndex = (this.stepIndex + 1) % STEP_COUNT
      this.nextStepTime += dur
    }
    return booked
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.steps))
    } catch {
      // best-effort
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as Step[]
      if (Array.isArray(saved) && saved.length === STEP_COUNT) {
        saved.forEach((s, i) => {
          this.steps[i] = { on: Boolean(s.on), semi: Math.max(0, Math.min(24, Number(s.semi) || 0)) }
        })
      }
    } catch {
      // keep defaults
    }
  }
}
