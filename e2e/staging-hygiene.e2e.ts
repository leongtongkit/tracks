// Staging copy checks: it must stay out of search engines and carry no analytics or ads.
// Runs only against a staging deployment (EXPECT_STAGING=1); skipped everywhere else.
import { expect, openStudio, test, TRACKS_URL, SYNTH_URL } from './fixtures'

test.skip(process.env.EXPECT_STAGING !== '1', 'staging copy only (set EXPECT_STAGING=1)')

const FORBIDDEN_IN_HTML = [
  'cdn-cgi/zaraz',
  '/ads.js',
  'googletagmanager',
  'googlesyndication',
  'adsbygoogle',
  'google-adsense-account',
]

const pages: { name: string; url: string }[] = [
  { name: 'tracks /', url: TRACKS_URL + '/' },
  { name: 'tracks /studio', url: TRACKS_URL + '/studio' },
  { name: 'tracks /blog/', url: TRACKS_URL + '/blog/' },
  { name: 'tracks blog post', url: TRACKS_URL + '/blog/make-lofi-hip-hop' },
  { name: 'synth /', url: SYNTH_URL + '/' },
]

test.describe('staging hygiene', () => {
  for (const { name, url } of pages) {
    test(`${name} is noindex and free of analytics and ads`, async ({ request }) => {
      const res = await request.get(url)
      expect(res.status()).toBe(200)
      expect(res.headers()['x-robots-tag'] ?? '').toContain('noindex')

      const html = await res.text()
      expect(html).toContain('<meta name="robots" content="noindex')
      for (const needle of FORBIDDEN_IN_HTML) {
        expect(html, `"${needle}" must not appear in ${url}`).not.toContain(needle)
      }
    })
  }

  for (const path of ['/ads.txt', '/ads.js', '/15ca66bb0604b7c67111e9fb2327fefc.txt']) {
    test(`tracks ${path} is not served`, async ({ request }) => {
      const res = await request.get(TRACKS_URL + path)
      expect(res.status()).toBe(404)
    })
  }

  test('tracks robots.txt disallows everything for all crawlers', async ({ request }) => {
    const res = await request.get(TRACKS_URL + '/robots.txt')
    expect(res.status()).toBe(200)
    const body = await res.text()

    // collect the rules that sit in the "User-agent: *" group
    const rules: string[] = []
    let inStar = false
    let lastWasAgent = false
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, '').trim()
      if (!line) continue
      const [key, ...rest] = line.split(':')
      const k = key.trim().toLowerCase()
      const v = rest.join(':').trim()
      if (k === 'user-agent') {
        inStar = lastWasAgent ? inStar || v === '*' : v === '*'
        lastWasAgent = true
      } else {
        lastWasAgent = false
        if (inStar) rules.push(`${k}: ${v}`)
      }
    }
    expect(rules).toContain('disallow: /')
    expect(rules).not.toContain('allow: /')
  })

  test('the studio makes no third-party requests', async ({ page, diag }) => {
    await openStudio(page)
    await page.waitForLoadState('networkidle')
    expect(diag.thirdParty).toEqual([])
  })
})
