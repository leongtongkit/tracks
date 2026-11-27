import { migrateProject, type Project } from './project'

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer())
}

export async function songToHash(project: Project): Promise<string> {
  const bytes = await transform(new TextEncoder().encode(JSON.stringify(project)), new CompressionStream('deflate-raw'))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return '#s=1.' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export async function hashToSong(hash: string): Promise<Project | null> {
  if (!/^#s=1\.[A-Za-z0-9_-]+$/.test(hash)) return null
  try {
    const binary = atob(hash.slice(5).replaceAll('-', '+').replaceAll('_', '/'))
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
    const json = new TextDecoder('utf-8', { fatal: true }).decode(await transform(bytes, new DecompressionStream('deflate-raw')))
    const raw: unknown = JSON.parse(json)
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { tracks?: unknown }).tracks)) return null
    return migrateProject(raw)
  } catch { return null }
}

export function shareableSong(project: Project): { song: Project; leftOut: string[] } {
  const song = JSON.parse(JSON.stringify(project)) as Project
  const leftOut: string[] = []
  song.tracks = song.tracks.filter(track => {
    const clips = [...track.clips, ...track.session.filter(c => c !== null)]
    const usesAudio = !!track.frozen || (track.kind === 'sampler' && !!track.sampler.sampleId) ||
      (track.kind === 'pads' && track.pads.pads.some(p => !!p.sampleId)) ||
      clips.some(c => !!c.audio || !!c.takes?.length)
    if (usesAudio) leftOut.push(track.name)
    return !usesAudio
  })
  song.samples = {}
  return { song, leftOut }
}
