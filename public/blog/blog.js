// Renders the blog hub cards from posts.json (newest first). Links are
// extensionless — Workers Static Assets serves /blog/<slug> from <slug>.html.
(function () {
  'use strict';
  var grid = document.getElementById('post-grid');
  if (!grid) return;
  fetch('/blog/posts.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (posts) {
      posts.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      grid.innerHTML = posts.map(function (p) {
        var tags = (p.tags || []).join(' · ');
        var date = new Date(p.date + 'T00:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        return (
          '<a class="post-card" href="/blog/' + p.slug + '">' +
            '<div class="pc-tags">' + tags + '</div>' +
            '<h2>' + p.title + '</h2>' +
            '<p class="pc-dek">' + p.dek + '</p>' +
            '<div class="pc-meta">' + date + ' · ' + (p.readingTime || '') + '</div>' +
          '</a>'
        );
      }).join('');
    })
    .catch(function () {
      grid.innerHTML = '<p style="color:var(--bone-dim);font-family:var(--font-mono);font-size:.8rem">Guides are loading… check back shortly.</p>';
    });
})();
