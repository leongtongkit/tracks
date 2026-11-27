import fixture from './share-link.v1.fixture.txt?raw'
import { describe, expect, it } from 'vitest'
import { demoSong } from './persist'
import { migrateProject, newTrack } from './project'
import { buildTemplate, TEMPLATE_IDS } from './templates'
import { hashToSong, shareableSong, songToHash } from './share-link'

const count = (p: ReturnType<typeof demoSong>): number => p.tracks.reduce((n, t) => n + t.clips.reduce((m, c) => m + c.notes.length, 0), 0)
describe('song links', () => {
  it('round trips the demo and starters within the link budget', async () => {
    for (const p of [demoSong(), ...TEMPLATE_IDS.map(buildTemplate)]) {
      const hash = await songToHash(p)
      console.log(`share-link ${p.name} ${hash.length}`)
      expect(hash.length).toBeLessThan(16000)
      expect(await hashToSong(hash)).toEqual(migrateProject(JSON.parse(JSON.stringify(p))))
    }
  })
  it('continues to decode the version 1 fixture', async () => {
    const decoded = await hashToSong(fixture.trim())
    const demo = demoSong()
    expect(decoded).not.toBeNull()
    expect(decoded!.name).toBe(demo.name)
    expect(decoded!.bpm).toBe(demo.bpm)
    expect(decoded!.tracks.map(t => t.name)).toEqual(demo.tracks.map(t => t.name))
    expect(count(decoded!)).toBe(count(demo))
  })
  it('rejects invalid links and non-project JSON', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ hello: 'world' }))
    const zipped = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    const nonSong = '#s=1.' + btoa(String.fromCharCode(...zipped)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    for (const hash of ['', '#', '#s=', '#s=9.abc', '#s=1.!!!', nonSong]) expect(await hashToSong(hash)).toBeNull()
  })
  it('leaves sample-dependent tracks out of a copy', () => {
    const p = demoSong()
    const audio = newTrack('Vocals', { kind: 'audio' })
    audio.clips = [{ id: 'a', start: 0, length: 4, notes: [], audio: { sampleId: 's', offsetSec: 0, gain: 1, warp: 'off', origBpm: 120, fadeIn: 0, fadeOut: 0 } }]
    const sampler = newTrack('Guitar', { kind: 'sampler' })
    sampler.sampler.sampleId = 's'
    p.samples.s = { name: 'sample', duration: 1 }
    p.tracks.push(audio, sampler)
    const result = shareableSong(p)
    expect(result.leftOut).toEqual(['Vocals', 'Guitar'])
    expect(result.song.tracks.map(t => t.name)).not.toContain('Vocals')
    expect(result.song.tracks.map(t => t.name)).not.toContain('Guitar')
    expect(result.song.samples).toEqual({})
    const clean = demoSong()
    expect(shareableSong(clean)).toEqual({ song: clean, leftOut: [] })
  })
})
