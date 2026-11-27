// The site lives at freetracks.app / synth.freetracks.app; tracks.jfound.net,
// synth.jfound.net, tracks.ocari.co, and synth.ocari.co are permanent redirects only. New pages and posts (the
// daily blog writer commits straight to main) must carry the new hosts in
// every canonical, og, sitemap and robots reference — CI runs this before
// the deploy, so an old-host page is caught before it reaches the site.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, test, expect } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function htmlFiles() {
  const files = ['index.html', 'studio.html', 'synth.html', 'sheet-music.html']
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.html')) files.push(relative(root, p))
    }
  }
  walk(join(root, 'public'))
  return files
}

describe('site lives at freetracks.app / synth.freetracks.app (four old hosts are permanent redirects only)', () => {
  for (const rel of htmlFiles()) {
    test(`${rel} names none of the four permanent-redirect-only hosts`, () => {
      const text = readFileSync(join(root, rel), 'utf8')
      expect(text).not.toContain('tracks.jfound.net')
      expect(text).not.toContain('synth.jfound.net')
      expect(text).not.toContain('tracks.ocari.co')
      expect(text).not.toContain('synth.ocari.co')
    })
  }

  test('sitemaps and robots list only freetracks.app / synth.freetracks.app addresses', () => {
    for (const rel of ['public/sitemap.xml', 'public/sitemap-synth.xml', 'public/robots.txt']) {
      const text = readFileSync(join(root, rel), 'utf8')
      expect(text).not.toContain('tracks.jfound.net')
      expect(text).not.toContain('synth.jfound.net')
      expect(text).not.toContain('tracks.ocari.co')
      expect(text).not.toContain('synth.ocari.co')
    }
  })

  test('product pages load the Zaraz loader exactly once', () => {
    for (const rel of ['index.html', 'studio.html', 'synth.html', 'sheet-music.html']) {
      const text = readFileSync(join(root, rel), 'utf8')
      expect(text.match(/cdn-cgi\/zaraz\/i\.js/g) ?? []).toHaveLength(1)
    }
  })

  test('every page carries the AdSense site tag exactly once', () => {
    for (const rel of htmlFiles()) {
      const text = readFileSync(join(root, rel), 'utf8')
      expect(text.match(/google-adsense-account/g) ?? []).toHaveLength(1)
    }
  })
})
