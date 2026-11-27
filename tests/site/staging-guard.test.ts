import { describe, expect, it } from 'vitest'
import { isBlockedPath, robotsBody, stripMeta, stripScript } from '../../staging-guard.js'

describe('staging policy', () => {
  it('blocks only the specified paths', () => {
    for (const path of ['/ads.txt', '/ads.js', '/15ca66bb0604b7c67111e9fb2327fefc.txt']) expect(isBlockedPath(path)).toBe(true)
    for (const path of ['/', '/build.txt', '/other/ads.js']) expect(isBlockedPath(path)).toBe(false)
  })
  it('disallows all robots', () => {
    expect(robotsBody()).toBe('User-agent: *\nDisallow: /\n')
  })
  it('strips the specified scripts', () => {
    for (const src of ['/cdn-cgi/zaraz/a.js', '/ads.js?v=1', 'https://example.com/x/ads.js#x', 'https://googletagmanager.com/a', 'https://googlesyndication.com/a']) expect(stripScript(src)).toBe(true)
    for (const src of ['', '/safe.js', '/ads.js/other', '/ads.js-extra']) expect(stripScript(src)).toBe(false)
  })
  it('strips the specified verification metadata', () => {
    for (const name of ['google-adsense-account', 'msvalidate.01', 'google-site-verification', 'MSVALIDATE.01']) expect(stripMeta(name)).toBe(true)
    for (const name of ['', 'robots', 'description']) expect(stripMeta(name)).toBe(false)
  })
})
