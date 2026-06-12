// Share links: the project (samples embedded) is stored by the worker's
// /api/share KV endpoint; the link is tracks.jfound.net/#s=<id>.

export async function uploadShare(json: string): Promise<string> {
  const res = await fetch('/api/share', { method: 'POST', body: json })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `share failed (${res.status})`)
  }
  const { id } = (await res.json()) as { id: string }
  return id
}

export async function fetchShare(id: string): Promise<string> {
  const res = await fetch(`/api/share/${id}`)
  if (!res.ok) throw new Error('share link not found or expired')
  return res.text()
}

export function shareIdFromHash(hash: string): string | null {
  return /^#s=([a-z0-9]{6,16})$/.exec(hash)?.[1] ?? null
}
