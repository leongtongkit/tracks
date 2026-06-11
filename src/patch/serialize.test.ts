import { describe, expect, it } from 'vitest'
import { buildPresetPatch, PRESETS } from './presets'
import { hashToPatch, patchToHash } from './serialize'
import { defaultPatch } from './schema'

describe('patch URL serialization', () => {
  it('round-trips the default patch exactly', async () => {
    const patch = defaultPatch()
    const hash = await patchToHash(patch)
    expect(hash.startsWith('#p=')).toBe(true)
    const back = await hashToPatch(hash)
    expect(back).toEqual(patch)
  })

  it('round-trips every factory preset exactly', async () => {
    for (const def of PRESETS) {
      const patch = buildPresetPatch(def)
      const back = await hashToPatch(await patchToHash(patch))
      expect(back).toEqual(patch)
    }
  })

  it('produces URL-safe, reasonably small hashes', async () => {
    const hash = await patchToHash(buildPresetPatch(PRESETS[0]))
    expect(hash).toMatch(/^#p=[A-Za-z0-9_-]+$/)
    expect(hash.length).toBeLessThan(1200)
  })

  it('returns null for foreign or missing hashes', async () => {
    expect(await hashToPatch('')).toBeNull()
    expect(await hashToPatch('#section-2')).toBeNull()
  })

  it('throws on corrupt patch data', async () => {
    await expect(hashToPatch('#p=corruptcorruptcorrupt')).rejects.toThrow()
    await expect(hashToPatch('#pj=aGVsbG8')).rejects.toThrow() // "hello" is not a patch
  })
})
