import { describe, expect, test } from 'vitest'
import { Analytics, isSongInProgress, readConsent, type AnalyticsEnv, type Props } from './analytics'
import { demoSong } from './persist'

function harness(choice: boolean | null) {
  const store = new Map<string, string>()
  if (choice !== null) store.set('jfound_cookie_consent', JSON.stringify({ v: 2, analytics: choice }))
  const sent: [string, Props | undefined][] = []
  let zaraz: { track(n: string, p?: Props): void; consent?: { APIReady?: boolean } } | undefined
  let consentCb: (a: boolean) => void = () => {}
  let readyCb: () => void = () => {}
  const timers: (() => void)[] = []
  const env: AnalyticsEnv = {
    storage: { getItem: k => store.get(k) ?? null },
    zaraz: () => zaraz,
    onConsent: cb => (consentCb = cb),
    onZarazReady: cb => (readyCb = cb),
    later: cb => void timers.push(cb),
  }
  const a = new Analytics(env)
  return {
    a,
    sent,
    loadZaraz(apiReady = true) {
      zaraz = { track: (n, p) => void sent.push([n, p]), consent: { APIReady: apiReady } }
    },
    // Zaraz's placeholder: track() exists, its consent API doesn't yet
    loadZarazPlaceholder() {
      zaraz = { track: (n, p) => void sent.push([n, p]) }
    },
    choose(analytics: boolean) {
      consentCb(analytics)
    },
    zarazReady() {
      if (zaraz) zaraz.consent = { APIReady: true }
      readyCb()
    },
    runTimers() {
      while (timers.length) timers.shift()!()
    },
  }
}

describe('studio analytics respect the privacy choice', () => {
  test('nothing is sent before the visitor chooses', () => {
    const h = harness(null)
    h.loadZaraz()
    h.a.track('studio_open')
    h.runTimers()
    expect(h.sent).toEqual([])
  })

  test('events wait for Allow, then go out in order', () => {
    const h = harness(null)
    h.loadZaraz()
    h.a.track('studio_open')
    h.a.track('export_audio', { format: 'wav' })
    h.choose(true)
    h.runTimers()
    expect(h.sent).toEqual([
      ['studio_open', undefined],
      ['export_audio', { format: 'wav' }],
    ])
  })

  test('Decline drops the queue and later events', () => {
    const h = harness(null)
    h.loadZaraz()
    h.a.track('studio_open')
    h.choose(false)
    h.runTimers()
    h.a.track('project_save')
    h.runTimers()
    expect(h.sent).toEqual([])
  })

  test('a visitor who declined earlier sends nothing', () => {
    const h = harness(false)
    h.loadZaraz()
    h.a.track('studio_open')
    h.runTimers()
    expect(h.sent).toEqual([])
  })

  test('a visitor who allowed earlier is counted once Zaraz is ready', () => {
    const h = harness(true)
    h.a.track('studio_open') // Zaraz script not loaded yet
    h.runTimers()
    expect(h.sent).toEqual([])
    h.loadZaraz(false) // loaded, consent API not ready
    h.runTimers()
    expect(h.sent).toEqual([])
    h.zarazReady()
    h.runTimers()
    expect(h.sent).toEqual([['studio_open', undefined]])
  })

  test("an event sent while Zaraz is still loading waits for its consent API, so GA4 doesn't drop it", () => {
    const h = harness(true)
    h.loadZarazPlaceholder()
    h.a.track('sheet_open', { from: 'saved' })
    h.runTimers()
    expect(h.sent).toEqual([])
    h.zarazReady()
    h.runTimers()
    expect(h.sent).toEqual([['sheet_open', { from: 'saved' }]])
  })

  test('once() counts an event a single time per page load', () => {
    const h = harness(true)
    h.loadZaraz()
    h.a.once('first_note')
    h.a.once('first_note')
    expect(h.sent).toEqual([['first_note', undefined]])
  })
})

describe('readConsent', () => {
  test('reads the stored choice and tolerates junk', () => {
    expect(readConsent({ getItem: () => JSON.stringify({ analytics: true }) })).toBe(true)
    expect(readConsent({ getItem: () => JSON.stringify({ analytics: false }) })).toBe(false)
    expect(readConsent({ getItem: () => null })).toBe(null)
    expect(readConsent({ getItem: () => '{not json' })).toBe(null)
  })
})

describe('isSongInProgress', () => {
  test('no saved session, or the untouched demo, is not a song in progress', () => {
    expect(isSongInProgress(null, demoSong())).toBe(false)
    expect(isSongInProgress(demoSong(), demoSong())).toBe(false)
  })

  test('a saved demo with a note added is a song in progress', () => {
    const saved = demoSong()
    saved.tracks[0].clips[0].notes.push({ start: 31, dur: 0.25, pitch: 40, vel: 0.8 })
    expect(isSongInProgress(saved, demoSong())).toBe(true)
  })
})
