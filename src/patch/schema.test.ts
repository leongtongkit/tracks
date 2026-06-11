import { describe, expect, it } from 'vitest'
import { defaultPatch, migrate, PATCH_VERSION } from './schema'

describe('patch migrate', () => {
  it('accepts a full default patch unchanged', () => {
    const p = defaultPatch()
    expect(migrate(JSON.parse(JSON.stringify(p)))).toEqual(p)
  })

  it('fills missing fields from defaults (partial patch)', () => {
    const partial = { v: PATCH_VERSION, name: 'X', filter: { cutoff: 999 } }
    const p = migrate(partial)
    expect(p.name).toBe('X')
    expect(p.filter.cutoff).toBe(999)
    expect(p.filter.resonance).toBe(defaultPatch().filter.resonance)
    expect(p.osc).toHaveLength(3)
    expect(p.fx.order).toHaveLength(6)
  })

  it('drops unknown fields', () => {
    const dirty = { v: PATCH_VERSION, evil: 'payload' }
    const p = migrate(dirty) as unknown as Record<string, unknown>
    expect(p.evil).toBeUndefined()
  })

  it('rejects wrong versions and non-objects', () => {
    expect(() => migrate({ v: 99 })).toThrow()
    expect(() => migrate(null)).toThrow()
    expect(() => migrate('hi')).toThrow()
  })

  it('merges nested arrays element-wise', () => {
    const partial = { v: PATCH_VERSION, osc: [{ level: 0.123 }] }
    const p = migrate(partial)
    expect(p.osc[0].level).toBe(0.123)
    expect(p.osc[0].wave).toBe('saw')
    expect(p.osc[1]).toEqual(defaultPatch().osc[1])
  })
})
