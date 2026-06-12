// tracks-jfound worker: serves the built app and a tiny share API.
// POST /api/share        body = project JSON (samples embedded) → { id }
// GET  /api/share/<id>   → the stored project JSON
// Shares expire after 90 days; size-capped well under the KV value limit.

const MAX_BYTES = 20_000_000
const TTL_S = 60 * 60 * 24 * 90

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/share')) {
      if (request.method === 'POST') {
        const body = await request.arrayBuffer()
        if (body.byteLength > MAX_BYTES) {
          return json({ error: 'project too large to share (20 MB max)' }, 413)
        }
        const id = crypto.randomUUID().replaceAll('-', '').slice(0, 10)
        await env.SHARES.put(id, body, { expirationTtl: TTL_S })
        return json({ id })
      }
      if (request.method === 'GET') {
        const id = url.pathname.split('/').pop() ?? ''
        if (!/^[a-z0-9]{6,16}$/.test(id)) return json({ error: 'bad id' }, 400)
        const value = await env.SHARES.get(id, 'stream')
        if (!value) return json({ error: 'not found or expired' }, 404)
        return new Response(value, {
          headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
        })
      }
      return json({ error: 'method not allowed' }, 405)
    }
    return env.ASSETS.fetch(request)
  },
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
