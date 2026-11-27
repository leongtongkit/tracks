// Only the small player (/embed) may be framed by other sites; every other
// page may be framed only by freetracks.app itself.
export function pageHeaders(path, contentType) {
  if (path === '/embed' || path === '/embed.html') {
    return { 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': 'frame-ancestors *' }
  }
  if (contentType && contentType.toLowerCase().includes('text/html')) {
    return { 'Content-Security-Policy': "frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN' }
  }
  return {}
}

// The site lives at freetracks.app; the previous addresses tracks.ocari.co and
// tracks.jfound.net permanently redirect here, same path and query, so old
// links and search results keep working.
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (['tracks.ocari.co', 'tracks.jfound.net', 'www.freetracks.app'].includes(url.hostname)) {
      url.protocol = 'https:'
      url.hostname = 'freetracks.app'
      return Response.redirect(url.toString(), 301)
    }
    const response = await env.ASSETS.fetch(request)
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(pageHeaders(url.pathname, headers.get('content-type')))) headers.set(name, value)
    if (url.pathname === '/embed' || url.pathname === '/embed.html') headers.delete('X-Frame-Options')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
}
