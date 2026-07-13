// public/blog/blog.js renders the hub cards from posts.json — a file written by
// an unattended routine in a public repo. These tests pin the two things that
// makes necessary: every field is escaped, and dates render in UTC.
//
// blog.js is a plain <script> IIFE (not a module), so we run it in a vm context
// with just enough of a DOM to capture what it writes into #post-grid.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, it, expect, beforeAll } from 'vitest'

// Pin a zone west of UTC so an un-pinned date formatter would slip a day back.
process.env.TZ = 'America/New_York'

const SRC = readFileSync(fileURLToPath(new URL('../../public/blog/blog.js', import.meta.url)), 'utf8')

async function renderHub(posts) {
  let html = ''
  const grid = {
    set innerHTML(v) { html = v },
    get innerHTML() { return html },
  }
  const ctx = {
    document: { getElementById: (id) => (id === 'post-grid' ? grid : null) },
    fetch: async () => ({ json: async () => posts }),
  }
  vm.createContext(ctx)
  vm.runInContext(SRC, ctx)
  await new Promise((r) => setImmediate(r)) // flush the fetch().then() chain
  return html
}

const post = (over = {}) => ({
  slug: 'a-guide', title: 'A guide', dek: 'A dek', date: '2026-07-12',
  tags: ['beats'], readingTime: '5 min read', ...over,
})

describe('blog hub rendering', () => {
  let baseline
  beforeAll(async () => { baseline = await renderHub([post()]) })

  it('renders a card for each post', () => {
    expect(baseline).toContain('class="post-card"')
    expect(baseline).toContain('A guide')
    expect(baseline).toContain('href="/blog/a-guide"')
  })

  describe('escapes untrusted posts.json fields', () => {
    const XSS = '<img src=x onerror="alert(1)">'

    it('escapes a script payload in the title', async () => {
      const html = await renderHub([post({ title: XSS })])
      // The payload survives only as inert text: no live tag, and its quotes are
      // entities, so it cannot open an element or an attribute.
      expect(html).not.toContain('<img')
      expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    })

    it('escapes markup in the dek', async () => {
      const html = await renderHub([post({ dek: '</p><script>alert(1)</script>' })])
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
    })

    it('escapes markup in tags', async () => {
      const html = await renderHub([post({ tags: ['<b>hot</b>', 'beats'] })])
      expect(html).not.toContain('<b>')
      expect(html).toContain('&lt;b&gt;')
    })

    it('escapes markup in readingTime', async () => {
      const html = await renderHub([post({ readingTime: '<svg onload=alert(1)>' })])
      expect(html).not.toContain('<svg')
      expect(html).toContain('&lt;svg')
    })

    it('does not let a slug break out of the href attribute', async () => {
      const html = await renderHub([post({ slug: '"><script>alert(1)</script>' })])
      expect(html).not.toContain('<script>')
      // the href stays a single quoted attribute value
      expect(html).toMatch(/href="\/blog\/[^"]*"/)
    })

    it('survives non-string field types', async () => {
      const html = await renderHub([post({ title: 42, dek: null, tags: 'not-an-array' })])
      expect(html).toContain('class="post-card"')
      expect(html).toContain('42')
    })
  })

  describe('dates', () => {
    it('renders the post date in UTC, not the viewer zone', () => {
      // TZ is America/New_York: a viewer-zone render of 2026-07-12T00:00:00Z
      // would read "Jul 11, 2026" — a day early, disagreeing with the article.
      expect(baseline).toContain('Jul 12, 2026')
      expect(baseline).not.toContain('Jul 11, 2026')
    })

    it('omits an unparseable date instead of printing "Invalid Date"', async () => {
      const html = await renderHub([post({ date: 'whenever' })])
      expect(html).not.toContain('Invalid Date')
      expect(html).toContain('5 min read')
    })
  })
})
