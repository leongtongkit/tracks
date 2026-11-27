export const robotsBody = () => 'User-agent: *\nDisallow: /\n'

export function isBlockedPath(path) {
  return ['/ads.txt', '/ads.js', '/15ca66bb0604b7c67111e9fb2327fefc.txt'].includes(path)
}

export function stripScript(src) {
  if (!src) return false
  const path = src.split(/[?#]/, 1)[0]
  return src.includes('/cdn-cgi/zaraz/') || path.endsWith('/ads.js') ||
    src.includes('googletagmanager.com') || src.includes('googlesyndication.com')
}

export function stripMeta(name) {
  return ['google-adsense-account', 'msvalidate.01', 'google-site-verification'].includes((name || '').toLowerCase())
}

export function stagingWorker(worker) {
  return {
    async fetch(request, env, ctx) {
      const path = new URL(request.url).pathname
      let response
      if (isBlockedPath(path)) {
        response = new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } })
      } else if (path === '/robots.txt') {
        response = new Response(robotsBody(), { headers: { 'Content-Type': 'text/plain' } })
      } else {
        response = await worker.fetch(request, env, ctx)
        if (/^text\/html(?:\s*;|\s*$)/i.test(response.headers.get('content-type') || '')) {
          response = new HTMLRewriter()
            .on('head', { element(element) { element.prepend('<meta name="robots" content="noindex, nofollow">', { html: true }) } })
            .on('script[src]', { element(element) { if (stripScript(element.getAttribute('src'))) element.remove() } })
            .on('meta[name]', { element(element) { if (stripMeta(element.getAttribute('name'))) element.remove() } })
            .transform(response)
          response.headers.delete('content-length')
        }
      }
      response = new Response(response.body, response)
      response.headers.set('X-Robots-Tag', 'noindex, nofollow')
      return response
    },
  }
}
