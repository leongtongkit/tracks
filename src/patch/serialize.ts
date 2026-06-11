import { migrate, type Patch } from './schema'

// Patch ⇄ URL fragment. Compressed form '#p=' (deflate-raw + base64url);
// uncompressed fallback '#pj=' for browsers without CompressionStream
// (Safari < 16.4). The fragment never reaches the server or CDN cache.

export async function patchToHash(patch: Patch): Promise<string> {
  const json = JSON.stringify(patch)
  if (typeof CompressionStream !== 'undefined') {
    const bytes = await pipeThrough(new TextEncoder().encode(json), new CompressionStream('deflate-raw'))
    return '#p=' + b64urlEncode(bytes)
  }
  return '#pj=' + b64urlEncode(new TextEncoder().encode(json))
}

// Returns null for absent/foreign hashes; throws on present-but-corrupt data.
export async function hashToPatch(hash: string): Promise<Patch | null> {
  if (hash.startsWith('#p=')) {
    const bytes = b64urlDecode(hash.slice(3))
    const json = new TextDecoder().decode(
      await pipeThrough(bytes, new DecompressionStream('deflate-raw')),
    )
    return migrate(JSON.parse(json))
  }
  if (hash.startsWith('#pj=')) {
    const json = new TextDecoder().decode(b64urlDecode(hash.slice(4)))
    return migrate(JSON.parse(json))
  }
  return null
}

async function pipeThrough(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
