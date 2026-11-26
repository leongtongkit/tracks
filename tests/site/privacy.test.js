// freetracks.app has its own privacy page, and every page with the site footer
// links to it and to "Cookie settings" (which reopens the consent notice).
// The daily blog writer clones an existing article as its template, so a post
// that drops these links would seed every later post: CI stops it here.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, test, expect } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

function htmlFiles() {
  const files = ['index.html', 'studio.html', 'synth.html']
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

describe('privacy page', () => {
  const page = read('public/privacy.html')

  test('is canonical on freetracks.app/privacy', () => {
    expect(page).toContain('<link rel="canonical" href="https://freetracks.app/privacy" />')
  })

  test('names Google ad cookies and links Google\'s ad-cookie policy (AdSense requirement)', () => {
    expect(page).toContain('https://policies.google.com/technologies/ads')
    expect(page).toContain('AdSense')
  })

  test('has the anchor that Cookie settings links fall back to without JavaScript', () => {
    expect(page).toContain('id="cookie-settings"')
  })

  test('is listed in the sitemap', () => {
    expect(read('public/sitemap.xml')).toContain('<loc>https://freetracks.app/privacy</loc>')
  })
})

describe('every page with the site footer links Privacy and Cookie settings', () => {
  const footed = htmlFiles().filter((rel) => read(rel).includes('class="site-foot"'))

  test('finds the footed pages to check', () => {
    expect(footed.length).toBeGreaterThan(100)
  })

  for (const rel of footed) {
    test(`${rel}`, () => {
      const foot = read(rel).split('class="site-foot"')[1]
      expect(foot).toContain('<a href="/privacy">Privacy</a>')
      expect(foot).toMatch(/<a [^>]*data-cookie-settings[^>]*>Cookie settings<\/a>/)
    })
  }
})

describe('pages without a footer still reach privacy and cookie settings', () => {
  test('synth page carries the corner links', () => {
    const synth = read('synth.html')
    expect(synth).toContain('<a href="/privacy">Privacy</a>')
    expect(synth).toContain('data-cookie-settings')
  })

  test('studio Settings panel carries the links', () => {
    const panel = read('src/daw/ui/settings-panel.ts')
    expect(panel).toContain("'/privacy'")
    expect(panel).toContain('cookieSettings')
  })
})
