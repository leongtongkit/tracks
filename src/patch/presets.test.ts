import { describe, expect, it } from 'vitest'
import { buildPresetPatch, PRESETS } from './presets'
import { PATCH_VERSION } from './schema'

describe('factory presets', () => {
  it('has at least 35 presets', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(35)
  })

  it('every preset builds into a valid current-version patch', () => {
    for (const def of PRESETS) {
      const p = buildPresetPatch(def)
      expect(p.v).toBe(PATCH_VERSION)
      expect(p.name).toBe(def.name)
      expect(p.category).toBe(def.category)
      expect(p.osc).toHaveLength(3)
      expect(p.osc.some(o => o.enabled && o.level > 0)).toBe(true)
      expect(p.fx.order).toHaveLength(6)
      expect(p.master.gain).toBeGreaterThan(0)
    }
  })

  it('preset names are unique', () => {
    const names = PRESETS.map(p => p.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('covers all sound categories', () => {
    const cats = new Set(PRESETS.map(p => p.category))
    for (const c of ['bass', 'lead', 'pad', 'pluck', 'keys', 'bell', 'brass', 'wobble', 'fx']) {
      expect(cats.has(c as never)).toBe(true)
    }
  })
})
