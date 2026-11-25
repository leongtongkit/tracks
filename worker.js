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
    return env.ASSETS.fetch(request)
  },
}
