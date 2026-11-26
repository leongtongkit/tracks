// IndexNow: engines confirm the key by fetching /<KEY>.txt, so the file must
// exist and hold exactly the key. llms.txt: every link it gives must be a page
// that exists on the site, so a renamed guide cannot leave it pointing at a 404.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, test, expect } from 'vitest'
import { KEY, SITE, urlsForChangedFiles, sitemapUrls, byHost } from '../../scripts/indexnow.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

describe('IndexNow', () => {
  test('the key file is served from public/ and holds exactly the key', () => {
    expect(KEY).toMatch(/^[a-zA-Z0-9-]{8,128}$/)
    expect(read(`public/${KEY}.txt`)).toBe(KEY)
  })

  test('maps changed blog files to their live URLs, plus the blog index', () => {
    expect(urlsForChangedFiles(['public/blog/what-is-a-daw.html', 'public/blog/posts.json', 'src/main.ts'])).toEqual([
      `${SITE}/blog/what-is-a-daw`,
      `${SITE}/blog/`,
    ])
    expect(urlsForChangedFiles(['public/blog/index.html'])).toEqual([`${SITE}/blog/`])
    expect(urlsForChangedFiles(['public/help/index.html', 'README.md'])).toEqual([])
  })

  test('groups sitemap URLs by host, one request per host', () => {
    const urls = ['public/sitemap.xml', 'public/sitemap-synth.xml'].flatMap((p) => sitemapUrls(read(p)))
    const groups = byHost(urls)
    expect([...groups.keys()].sort()).toEqual(['freetracks.app', 'synth.freetracks.app'])
    expect(groups.get('freetracks.app').length).toBeGreaterThan(100)
  })
})

describe('llms.txt', () => {
  const txt = read('public/llms.txt')
  const links = [...txt.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => m[1])

  test('starts with the site name and a one-line summary', () => {
    expect(txt.startsWith('# Tracks\n\n> ')).toBe(true)
  })

  test('every freetracks.app link is a page in the sitemap', () => {
    const known = new Set(['public/sitemap.xml', 'public/sitemap-synth.xml'].flatMap((p) => sitemapUrls(read(p))))
    known.add(`${SITE}/sitemap.xml`)
    const own = links.filter((u) => /^https:\/\/(synth\.)?freetracks\.app\//.test(u))
    expect(own.length).toBeGreaterThan(10)
    for (const u of own) expect(known.has(u), u).toBe(true)
  })

  test('every guide it names exists as a blog page', () => {
    for (const u of links.filter((l) => l.startsWith(`${SITE}/blog/`) && l !== `${SITE}/blog/`)) {
      expect(existsSync(join(root, `public/blog/${u.slice(`${SITE}/blog/`.length)}.html`)), u).toBe(true)
    }
  })
})
