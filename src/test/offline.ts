// In-browser verification harness: renders notes through the real engine in an
// OfflineAudioContext and returns measurable stats. Driven from Playwright /
// browser MCP via window.__synthRenderTest(...).

import { Engine } from '../engine/engine'
import { Store } from '../state/store'
import { migrate, PATCH_VERSION, type Patch } from '../patch/schema'

export interface RenderStats {
  peak: number
  rms: number
  silent: boolean
  hasNaN: boolean
  duration: number
  // RMS in four equal windows, to sanity-check envelope shape
  windows: number[]
}

export async function renderTest(
  patchOverride?: Partial<Patch> | null,
  notes: { note: number; on: number; off: number }[] = [{ note: 60, on: 0, off: 0.5 }],
  duration = 1,
): Promise<RenderStats> {
  const ctx = new OfflineAudioContext(2, Math.ceil(44100 * duration), 44100)
  const store = new Store()
  if (patchOverride) {
    // deep-merge partial overrides onto defaults via the schema migrator
    store.loadPatch(migrate({ v: PATCH_VERSION, ...patchOverride }))
  }
  const engine = new Engine(ctx, store)
  await engine.ready // worklet modules must load before rendering starts

  for (const n of notes) {
    ctx.suspend(n.on).catch(() => {}).then(() => {
      engine.noteOn(n.note)
      ctx.resume().catch(() => {})
    })
    if (n.off < duration) {
      ctx.suspend(n.off).catch(() => {}).then(() => {
        engine.noteOff(n.note)
        ctx.resume().catch(() => {})
      })
    }
  }

  const buf = await ctx.startRendering()
  return analyzeBuffer(buf)
}

export function analyzeBuffer(buf: AudioBuffer): RenderStats {
  let peak = 0
  let sumSq = 0
  let hasNaN = false
  const n = buf.length
  const windows = [0, 0, 0, 0]
  const wLen = Math.floor(n / 4)

  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < n; i++) {
      const v = data[i]
      if (Number.isNaN(v) || !Number.isFinite(v)) {
        hasNaN = true
        continue
      }
      const a = Math.abs(v)
      if (a > peak) peak = a
      sumSq += v * v
      const w = Math.min(3, Math.floor(i / wLen))
      windows[w] += v * v
    }
  }

  const samples = n * buf.numberOfChannels
  return {
    peak,
    rms: Math.sqrt(sumSq / samples),
    silent: peak < 1e-4,
    hasNaN,
    duration: buf.duration,
    windows: windows.map(w => Math.sqrt(w / (wLen * buf.numberOfChannels))),
  }
}

// Render every factory preset and return per-preset stats; drives the
// automated Phase 5 sweep from the browser harness.
export async function presetSweep(): Promise<
  { name: string; peak: number; rms: number; silent: boolean; hasNaN: boolean }[]
> {
  const { PRESETS, buildPresetPatch } = await import('../patch/presets')
  const out = []
  for (const def of PRESETS) {
    const stats = await renderTest(buildPresetPatch(def), [{ note: 57, on: 0, off: 0.6 }], 1.4)
    out.push({ name: def.name, peak: stats.peak, rms: stats.rms, silent: stats.silent, hasNaN: stats.hasNaN })
  }
  return out
}

declare global {
  interface Window {
    __synthRenderTest: typeof renderTest
    __synthPresetSweep: typeof presetSweep
  }
}

export function installRenderTest(): void {
  window.__synthRenderTest = renderTest
  window.__synthPresetSweep = presetSweep
}
