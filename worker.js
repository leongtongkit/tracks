// tracks.ocari.co worker: serves the site from static assets; the previous
// address (tracks.jfound.net) permanently redirects here, same path and
// query, so old links and search results keep working.
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.hostname === 'tracks.jfound.net') {
      url.protocol = 'https:'
      url.hostname = 'tracks.ocari.co'
      return Response.redirect(url.toString(), 301)
    }
    return env.ASSETS.fetch(request)
  },
}
