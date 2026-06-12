// synth.jfound.net worker: serves the synth standalone page from the shared
// build (the repo root now belongs to the Tracks DAW).
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      // '/synth' is the canonical asset path (html_handling strips '.html');
      // rewriting straight to it avoids a 307 bounce on the root
      url.pathname = '/synth'
      return env.ASSETS.fetch(new Request(url, request))
    }
    return env.ASSETS.fetch(request)
  },
}
