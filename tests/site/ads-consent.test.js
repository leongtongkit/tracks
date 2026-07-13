// The site promises "Decline = no ads are ever requested" (public/ads.js). These
// tests hold the product to that promise: nothing may reach out to Google unless
// the visitor allowed it, and allowing it must take effect in the tab where the
// visitor clicked — not on their next navigation.
//
// consent.js and ads.js are plain <script> IIFEs, so we run them in one vm
// context (they share a "tab") against a DOM stub small enough to read.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import vm from 'node:vm'
import { describe, it, expect, beforeEach } from 'vitest'

const root = (p) => fileURLToPath(new URL('../../' + p, import.meta.url))
const ADS_JS = readFileSync(root('public/ads.js'), 'utf8')
const CONSENT_JS = readFileSync(root('public/consent.js'), 'utf8')
const ADSENSE_HOST = 'pagead2.googlesyndication.com'

function makeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [], attrs: {}, dataset: {}, style: {}, _html: '',
    classList: { add() {}, remove() {} },
    set innerHTML(v) { this._html = v },
    get innerHTML() { return this._html },
    setAttribute(k, v) { this.attrs[k] = String(v) },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null },
    appendChild(c) { this.children.push(c); return c },
    remove() {},
    addEventListener() {},
    querySelector() { return null },
    querySelectorAll() { return [] },
  }
}

// One browser tab: consent.js and ads.js loaded into a shared window.
function openTab({ storedConsent = null } = {}) {
  const store = new Map()
  if (storedConsent !== null) {
    store.set('jfound_cookie_consent', JSON.stringify({ v: 2, essential: true, analytics: storedConsent }))
  }
  const head = makeEl('head')
  const body = makeEl('body')
  const buttons = {} // consent panel buttons, by selector, with their click handlers
  const listeners = {}

  const makeBox = () => {
    const box = makeEl('div')
    box.querySelector = (sel) => {
      if (!buttons[sel]) {
        buttons[sel] = { ...makeEl('button'), _click: null }
        buttons[sel].addEventListener = (type, fn) => { if (type === 'click') buttons[sel]._click = fn }
      }
      return buttons[sel]
    }
    return box
  }

  const ctx = {
    document: {
      readyState: 'complete',
      head, body, documentElement: makeEl('html'),
      createElement: (tag) => (tag === 'div' ? makeBox() : makeEl(tag)),
      addEventListener() {},
      // ads.js asks "is adsbygoogle already on the page?" before injecting
      querySelector: (sel) =>
        (sel.includes('adsbygoogle')
          ? head.children.find((c) => String(c.src || '').includes('adsbygoogle.js')) || null
          : null),
      querySelectorAll: () => [],
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    location: { pathname: '/blog/' },
    MutationObserver: class { observe() {} },
    getComputedStyle: () => ({ display: 'none' }),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail } },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn) },
    dispatchEvent(e) { (listeners[e.type] || []).forEach((fn) => fn(e)); return true },
  }
  ctx.window = ctx
  vm.createContext(ctx)
  vm.runInContext(CONSENT_JS, ctx)
  vm.runInContext(ADS_JS, ctx)

  return {
    /** every script URL this tab has asked the network for */
    requestedScripts: () => head.children.map((c) => String(c.src || '')).filter(Boolean),
    adsenseRequested: () => head.children.some((c) => String(c.src || '').includes(ADSENSE_HOST)),
    click: (sel) => buttons[sel]._click(),
    storedConsent: () => store.get('jfound_cookie_consent'),
  }
}

describe('no ad network is contacted without consent', () => {
  it('requests nothing from Google before the visitor answers the panel', () => {
    const tab = openTab()
    expect(tab.requestedScripts()).toEqual([])
    expect(tab.adsenseRequested()).toBe(false)
  })

  it('requests nothing after DECLINE — the promise the panel makes', () => {
    const tab = openTab()
    tab.click('.cm-no')
    expect(tab.adsenseRequested()).toBe(false)
    expect(tab.storedConsent()).toContain('"analytics":false')
  })

  it('requests nothing for a returning visitor who declined earlier', () => {
    expect(openTab({ storedConsent: false }).adsenseRequested()).toBe(false)
  })

  it('loads AdSense for a returning visitor who allowed it', () => {
    expect(openTab({ storedConsent: true }).adsenseRequested()).toBe(true)
  })
})

describe('ALLOW takes effect in the tab that clicked it', () => {
  it('loads AdSense immediately on ALLOW, without a reload', () => {
    const tab = openTab()
    expect(tab.adsenseRequested()).toBe(false) // pre-consent: silent
    tab.click('.cm-yes')
    // 'storage' never fires in the writing tab, so this only passes because
    // consent.js signals its own tab directly.
    expect(tab.adsenseRequested()).toBe(true)
    expect(tab.storedConsent()).toContain('"analytics":true')
  })

  it('loads AdSense exactly once', () => {
    const tab = openTab()
    tab.click('.cm-yes')
    const hits = tab.requestedScripts().filter((s) => s.includes(ADSENSE_HOST))
    expect(hits).toHaveLength(1)
  })
})

describe('no page hardcodes the ad script', () => {
  // The head tag was the bypass: it ran on first paint, before consent existed.
  // The daily routine clones an existing article as its chrome template, so a
  // single page carrying it again would seed every future post.
  const htmlFiles = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'dist', '.git'].includes(name)) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith('.html')) htmlFiles.push(p)
    }
  }
  walk(root('.'))

  it('finds the site HTML to check', () => {
    expect(htmlFiles.length).toBeGreaterThan(30)
  })

  it.each(htmlFiles.map((f) => relative(root('.'), f)))('%s does not embed the ad script', (rel) => {
    expect(readFileSync(root(rel), 'utf8')).not.toContain(ADSENSE_HOST)
  })
})
