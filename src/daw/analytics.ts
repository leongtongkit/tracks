// Studio usage counts for Google Analytics (GA4 through Cloudflare Zaraz).
// Only which features get used is counted, never song content. Nothing is
// sent unless the visitor chose Allow in the privacy notice: until they
// choose, events wait in memory; on Decline they are dropped.

import type { Project } from './project'

const CONSENT_KEY = 'jfound_cookie_consent' // written by public/consent.js
const CONSENT_EVENT = 'jfound:consent' // consent.js fires this in the tab that chose
const MAX_QUEUE = 50
const RETRY_MS = 500
const MAX_RETRIES = 120 // give Zaraz up to a minute to load

export type Props = Record<string, string | number>
export type Consent = boolean | null // null = not chosen yet

interface ZarazLike {
  track(name: string, props?: Props): unknown
  consent?: { APIReady?: boolean }
}

export interface AnalyticsEnv {
  storage: Pick<Storage, 'getItem'>
  zaraz: () => ZarazLike | undefined
  onConsent: (cb: (analytics: boolean) => void) => void
  onZarazReady: (cb: () => void) => void
  later: (cb: () => void, ms: number) => void
}

export function readConsent(storage: Pick<Storage, 'getItem'>): Consent {
  try {
    const p = JSON.parse(storage.getItem(CONSENT_KEY) || 'null')
    return p && typeof p.analytics === 'boolean' ? p.analytics : null
  } catch {
    return null
  }
}

export class Analytics {
  private queue: [string, Props | undefined][] = []
  private consent: Consent
  private retries = 0
  private retrying = false
  private sentOnce = new Set<string>()

  constructor(private readonly env: AnalyticsEnv) {
    this.consent = readConsent(env.storage)
    env.onConsent(analytics => {
      this.consent = analytics
      // consent.js hands the choice to Zaraz right after this event; send after it
      env.later(() => this.flush(), 300)
    })
    env.onZarazReady(() => env.later(() => this.flush(), 0))
  }

  track(name: string, props?: Props): void {
    if (this.consent === false) return
    if (this.queue.length < MAX_QUEUE) this.queue.push([name, props])
    this.flush()
  }

  // once per page load, e.g. the first note placed. Kept in memory only, so
  // nothing new is stored in the browser for analytics.
  once(name: string, props?: Props): void {
    if (this.sentOnce.has(name)) return
    this.sentOnce.add(name)
    this.track(name, props)
  }

  private flush(): void {
    if (this.consent === false) {
      this.queue = []
      return
    }
    if (this.consent !== true || !this.queue.length) return
    const z = this.env.zaraz()
    // Zaraz defines a placeholder zaraz.track before its consent API exists; an event
    // sent through it then goes out before the visitor's choice reaches Zaraz, and
    // GA4 drops it. So wait for the consent API itself (consent.js hands the choice
    // over the moment it is ready).
    if (!z || typeof z.track !== 'function' || !z.consent?.APIReady) {
      this.retry()
      return
    }
    const pending = this.queue
    this.queue = []
    for (const [name, props] of pending) {
      try {
        z.track(name, props)
      } catch {
        // analytics must never break the studio
      }
    }
  }

  private retry(): void {
    if (this.retrying || this.retries >= MAX_RETRIES) return
    this.retrying = true
    this.retries++
    this.env.later(() => {
      this.retrying = false
      this.flush()
    }, RETRY_MS)
  }
}

// A saved session that is not just the untouched demo song is a song in
// progress. Ids differ on every load, so compare the musical content only.
export function isSongInProgress(saved: Project | null, demo: Project): boolean {
  if (!saved) return false
  const shape = (p: Project): string =>
    JSON.stringify([
      p.name,
      p.bpm,
      p.tracks.map(t => [t.name, t.clips.map(c => [c.start, c.length, !!c.audio, (c.notes ?? []).map(n => [n.start, n.dur, n.pitch])])]),
    ])
  return shape(saved) !== shape(demo)
}

function browserEnv(): AnalyticsEnv {
  const w = window as unknown as { zaraz?: ZarazLike }
  return {
    storage: localStorage,
    zaraz: () => w.zaraz,
    onConsent: cb =>
      window.addEventListener(CONSENT_EVENT, e => {
        const a = (e as CustomEvent<{ analytics?: unknown }>).detail?.analytics
        if (typeof a === 'boolean') cb(a)
      }),
    onZarazReady: cb => document.addEventListener('zarazConsentAPIReady', cb),
    later: (cb, ms) => void setTimeout(cb, ms),
  }
}

let shared: Analytics | null = null
function instance(): Analytics | null {
  if (shared) return shared
  try {
    shared = new Analytics(browserEnv())
  } catch {
    return null
  }
  return shared
}

export function track(name: string, props?: Props): void {
  instance()?.track(name, props)
}

export function trackOnce(name: string, props?: Props): void {
  instance()?.once(name, props)
}
