// Renders the blog hub cards from posts.json (newest first). Links are
// extensionless — Workers Static Assets serves /blog/<slug> from <slug>.html.
//
// posts.json is written by an unattended routine, and this repo is public, so
// every field below is untrusted input: escape it before it reaches innerHTML.
(function () {
  'use strict';
  var grid = document.getElementById('post-grid');
  if (!grid) return;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // p.date is a UTC calendar date (YYYY-MM-DD). Format it in UTC too — rendering
  // it in the viewer's zone dates every post a day early west of UTC.
  function fmtDate(d) {
    var t = Date.parse(String(d == null ? '' : d) + 'T00:00:00Z');
    if (isNaN(t)) return '';
    return new Date(t).toLocaleDateString('en-US', {
      timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  fetch('/blog/posts.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (posts) {
      if (!Array.isArray(posts)) posts = [];
      posts.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
      grid.innerHTML = posts.map(function (p) {
        var tags = (Array.isArray(p.tags) ? p.tags : []).map(esc).join(' · ');
        // Slugs are single path segments; encode so one can't escape the path.
        var href = '/blog/' + encodeURIComponent(String(p.slug == null ? '' : p.slug));
        var meta = [fmtDate(p.date), esc(p.readingTime)].filter(Boolean).join(' · ');
        return (
          '<a class="post-card" href="' + esc(href) + '">' +
            '<div class="pc-tags">' + tags + '</div>' +
            '<h2>' + esc(p.title) + '</h2>' +
            '<p class="pc-dek">' + esc(p.dek) + '</p>' +
            '<div class="pc-meta">' + meta + '</div>' +
          '</a>'
        );
      }).join('');
    })
    .catch(function () {
      grid.innerHTML = '<p style="color:var(--bone-dim);font-family:var(--font-mono);font-size:.8rem">Guides are loading… check back shortly.</p>';
    });
})();
