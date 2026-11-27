import { test as base, expect, type Page } from '@playwright/test'

export const TRACKS_URL = (process.env.TRACKS_URL ?? 'http://localhost:8787').replace(/\/+$/, '')
export const SYNTH_URL = (process.env.SYNTH_URL ?? 'http://localhost:8788').replace(/\/+$/, '')

const FIRST_PARTY = new Set([new URL(TRACKS_URL).origin, new URL(SYNTH_URL).origin])

// 1x1 transparent GIF, so a stubbed image request still decodes
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export interface Diagnostics {
  /** console messages of type "error" */
  consoleErrors: string[]
  /** uncaught exceptions */
  pageErrors: string[]
  /** every request whose origin is not the site under test (all answered with an empty 200) */
  thirdParty: string[]
}

interface Fixtures {
  diag: Diagnostics
}

export const test = base.extend<Fixtures>({
  // Consent and the first-visit tip are preset once per browser context, so
  // every page a test opens is covered.
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      try {
        // "decline" is a stored choice, so the privacy panel never covers a control
        if (!localStorage.getItem('jfound_cookie_consent')) {
          localStorage.setItem(
            'jfound_cookie_consent',
            JSON.stringify({ v: 2, essential: true, analytics: false, savedAt: new Date().toISOString() }),
          )
        }
        localStorage.setItem('tracks.tip.v1', 'dismissed')
      } catch { /* storage unavailable */ }
    })
    await use(context)
  },

  // Third-party isolation: every request outside the site under test is
  // answered with an empty 200 (never aborted, which would log console errors)
  // and recorded, so the live analytics and ad hosts are never reached.
  diag: async ({ context }, use) => {
    const diag: Diagnostics = { consoleErrors: [], pageErrors: [], thirdParty: [] }

    await context.route(
      url => (url.protocol === 'http:' || url.protocol === 'https:') && !FIRST_PARTY.has(url.origin),
      route => {
        const req = route.request()
        diag.thirdParty.push(req.url())
        const type = req.resourceType()
        const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
        if (type === 'script') return route.fulfill({ status: 200, headers, contentType: 'application/javascript', body: '' })
        if (type === 'stylesheet') return route.fulfill({ status: 200, headers, contentType: 'text/css', body: '' })
        if (type === 'image') return route.fulfill({ status: 200, headers, contentType: 'image/gif', body: GIF })
        return route.fulfill({ status: 200, headers, contentType: 'text/plain', body: '' })
      },
    )

    const watch = (page: Page): void => {
      page.on('console', m => {
        if (m.type() === 'error') diag.consoleErrors.push(`${m.text()} (${m.location().url})`)
      })
      page.on('pageerror', e => diag.pageErrors.push(String(e)))
    }
    context.pages().forEach(watch)
    context.on('page', watch)
    await use(diag)
  },

  // every test gets isolation and diagnostics wired before its page navigates
  page: async ({ page, diag }, use) => {
    void diag
    await use(page)
  },
})

export { expect }

interface AppShape {
  project: { name: string; bpm: number; tracks: { name: string; clips: { notes?: unknown[] }[] }[] }
  transport: { playing: boolean; positionBeat(): number }
}

/** Open the studio, wait until the app is booted, and unlock audio the way a visitor does. */
export async function openStudio(page: Page, path = '/studio'): Promise<void> {
  await page.goto(TRACKS_URL + path)
  await waitForStudio(page)
}

export async function waitForStudio(page: Page): Promise<void> {
  await expect(page.locator('.transport-bar')).toBeVisible()
  await page.waitForFunction(() => Boolean((window as unknown as { __tracksApp?: unknown }).__tracksApp))
  const scrim = page.locator('#scrim')
  if (await scrim.isVisible()) {
    await scrim.click()
    await expect(scrim).toBeHidden()
  }
}

/** Snapshot of the open song, read from app state. */
export interface SongState {
  name: string
  bpm: number
  tracks: string[]
  noteCount: number
}

export async function songState(page: Page): Promise<SongState> {
  return page.evaluate(() => {
    const app = (window as unknown as { __tracksApp: AppShape }).__tracksApp
    const p = app.project
    return {
      name: p.name,
      bpm: p.bpm,
      tracks: p.tracks.map(t => t.name),
      noteCount: p.tracks.reduce((n, t) => n + t.clips.reduce((m, c) => m + (c.notes?.length ?? 0), 0), 0),
    }
  })
}

export async function transportState(page: Page): Promise<{ playing: boolean; beat: number }> {
  return page.evaluate(() => {
    const t = (window as unknown as { __tracksApp: AppShape }).__tracksApp.transport
    return { playing: t.playing, beat: t.positionBeat() }
  })
}

/** Open the Songs panel from the file bar and return its dialog. */
export async function openSongsPanel(page: Page) {
  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Songs' })
  await expect(dialog).toBeVisible()
  return dialog
}
