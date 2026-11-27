import { readFile } from 'node:fs/promises'
import { buildTemplate, TEMPLATE_IDS, TEMPLATE_LABELS } from '../src/daw/templates'
import { expect, openSongsPanel, openStudio, songState, test, transportState, TRACKS_URL, type SongState } from './fixtures'
import type { Page } from '@playwright/test'
import { parseWav } from './wav'

/** Songs panel > a "Start a new song" button. The untouched demo song is replaced without a question. */
async function startFromSongsPanel(page: Page, label: string): Promise<void> {
  const dialog = await openSongsPanel(page)
  await dialog.getByRole('button', { name: label, exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** Double-click an empty spot in a track's lane to make a clip, as the on-screen tip says. */
async function makeClip(page: Page, laneIndex: number): Promise<void> {
  const before = await page.locator('.clip').count()
  const box = await page.locator('.lane').nth(laneIndex).boundingBox()
  if (!box) throw new Error('lane not on screen')
  await page.mouse.dblclick(box.x + 60, box.y + box.height / 2)
  await expect(page.locator('.clip')).toHaveCount(before + 1)
}

/** A Keys clip with one note in it, placed through the piano roll. */
async function placeNote(page: Page): Promise<void> {
  await makeClip(page, 1) // Keys
  const roll = page.locator('.proll-scroll')
  await expect(roll).toBeVisible()
  const box = await roll.boundingBox()
  if (!box) throw new Error('piano roll not on screen')
  await page.mouse.click(box.x + 200, box.y + box.height / 2)
  await expect(page.locator('.proll-note')).toHaveCount(1)
}

function expectedSong(id: (typeof TEMPLATE_IDS)[number]): SongState {
  const p = buildTemplate(id)
  return {
    name: p.name,
    bpm: p.bpm,
    tracks: p.tracks.map(t => t.name),
    noteCount: p.tracks.reduce((n, t) => n + t.clips.reduce((m, c) => m + c.notes.length, 0), 0),
  }
}

test.describe('studio', () => {
  test('place a note in the piano roll', async ({ page }) => {
    await openStudio(page)
    await startFromSongsPanel(page, 'New empty song')
    expect((await songState(page)).noteCount).toBe(0)

    await placeNote(page)
    expect((await songState(page)).noteCount).toBe(1)
  })

  test('play advances the transport and stop halts it', async ({ page }) => {
    await openStudio(page)
    const play = page.getByRole('button', { name: 'Play', exact: true })
    await expect(play).toBeVisible()
    expect((await transportState(page)).playing).toBe(false)

    await play.click()
    const stop = page.getByRole('button', { name: 'Stop', exact: true })
    await expect(stop).toBeVisible()
    await expect.poll(async () => (await transportState(page)).beat, { timeout: 15_000 }).toBeGreaterThan(1)
    expect((await transportState(page)).playing).toBe(true)
    // the position readout moves too
    await expect(page.locator('.pos-chip')).not.toHaveText('1.1')

    await stop.click()
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await expect.poll(async () => (await transportState(page)).playing).toBe(false)

    // stopped means the position stays put across frames
    const at = (await transportState(page)).beat
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
    expect((await transportState(page)).beat).toBe(at)
  })

  for (const id of TEMPLATE_IDS) {
    test(`new song from the ${TEMPLATE_LABELS[id]} starter loads`, async ({ page }) => {
      const want = expectedSong(id)
      expect(want.tracks.length).toBeGreaterThan(0)
      await openStudio(page)
      await startFromSongsPanel(page, TEMPLATE_LABELS[id])

      await expect.poll(() => songState(page)).toEqual(want)
      await expect(page.locator('.song-name')).toHaveText(want.name)
      await expect(page.locator('.track-name')).toHaveText(want.tracks)
      await expect(page.locator('.bar-space')).toBeVisible()
      // the tempo dial shows the starter's tempo
      await expect(page.locator('.transport-bar .mini-dial output').first()).toHaveText(String(Math.round(want.bpm)))
    })
  }

  test('drum step grid square toggles on and off', async ({ page }) => {
    await openStudio(page)
    await startFromSongsPanel(page, 'New empty song')
    await page.getByRole('button', { name: '+ Drums' }).click()
    await expect(page.locator('.track-name')).toHaveCount(5)
    await makeClip(page, 4) // the new drums lane

    const cell = page.getByRole('button', { name: 'Kick, bar 1, step 1', exact: true })
    await expect(cell).toBeVisible()
    await expect(cell).toHaveAttribute('aria-pressed', 'false')
    await cell.click()
    await expect(cell).toHaveAttribute('aria-pressed', 'true')
    await expect(cell).toHaveClass(/seq-on/)
    expect((await songState(page)).noteCount).toBe(1)
    await cell.click()
    await expect(cell).toHaveAttribute('aria-pressed', 'false')
    expect((await songState(page)).noteCount).toBe(0)
  })

  test('a renamed song shows its new name in the Songs list right away', async ({ page }) => {
    await openStudio(page)
    await startFromSongsPanel(page, 'New empty song')
    await placeNote(page)
    // wait until autosave has kept the song under its first name
    await expect.poll(() => page.evaluate(() => {
      const raw = localStorage.getItem('tracks.songs.v1')
      return raw ? (JSON.parse(raw) as { songs: { name: string }[] }).songs.map(s => s.name) : []
    })).toEqual(['Untitled'])

    const dialog = await openSongsPanel(page)
    const rows = dialog.locator('.songs-title')
    await expect(rows).toHaveText(['Untitled (open now)'])
    await dialog.getByRole('textbox', { name: 'Song name' }).fill('My renamed beat')
    // read straight away, with no retrying: the row must already carry the new name
    expect(await rows.allTextContents()).toEqual(['My renamed beat (open now)'])
    await expect(page.locator('.song-name')).toHaveText('My renamed beat')
  })

  test('save to a file and open it again', async ({ page }) => {
    await openStudio(page)
    await startFromSongsPanel(page, 'Rock')
    const saved = await songState(page)
    const dialog = await openSongsPanel(page)
    await dialog.getByRole('textbox', { name: 'Song name' }).fill('Round trip song')
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click()
    await expect(dialog).toBeHidden()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save', exact: true }).click(),
    ])
    expect(download.suggestedFilename()).toBe('Round-trip-song.tracks.json')
    const file = test.info().outputPath('round-trip.tracks.json')
    await download.saveAs(file)
    const json = JSON.parse(await readFile(file, 'utf8')) as { name: string; tracks: unknown[] }
    expect(json.name).toBe('Round trip song')

    // a fresh page: new context storage, so the demo song is what is open
    const fresh = await page.context().browser()!.newContext({ viewport: page.viewportSize() })
    try {
      await fresh.addInitScript(() => {
        localStorage.setItem('jfound_cookie_consent', JSON.stringify({ v: 2, essential: true, analytics: false, savedAt: new Date().toISOString() }))
        localStorage.setItem('tracks.tip.v1', 'dismissed')
      })
      // keep this context inside the same isolation as the fixture's
      await fresh.route(u => !u.href.startsWith(TRACKS_URL), r => r.fulfill({ status: 200, contentType: 'text/plain', body: '' }))
      const page2 = await fresh.newPage()
      await openStudio(page2)
      expect((await songState(page2)).name).not.toBe('Round trip song')

      const [chooser] = await Promise.all([
        page2.waitForEvent('filechooser'),
        page2.getByRole('button', { name: 'Open', exact: true }).click(),
      ])
      await chooser.setFiles(file)
      // the demo song has content, so the app asks before replacing it
      await page2.getByRole('dialog', { name: 'Replace the current song?' }).getByRole('button', { name: 'Replace', exact: true }).click()

      await expect.poll(() => songState(page2)).toEqual({ ...saved, name: 'Round trip song' })
      await expect(page2.locator('.song-name')).toHaveText('Round trip song')
      await expect(page2.locator('.track-name')).toHaveText(saved.tracks)
    } finally {
      await fresh.close()
    }
  })

  test('WAV export is a real, non-silent file', async ({ page }) => {
    await openStudio(page)
    await startFromSongsPanel(page, 'Lo-fi')
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByRole('button', { name: 'Export WAV' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('Lo-fi-sketch.wav')
    const path = await download.path()
    const wav = parseWav(await readFile(path))

    expect(wav.channels).toBe(2)
    expect(wav.sampleRate).toBeGreaterThanOrEqual(22050)
    // 8 bars of 4 beats at 80 bpm = 24 s
    expect(wav.seconds).toBeGreaterThan(20)
    expect(wav.seconds).toBeLessThan(60)
    expect(wav.peak).toBeGreaterThan(0.05)
    await expect(page.getByRole('button', { name: 'Export WAV' })).toBeEnabled()
  })

  test('WAV export plays every note of a melody, not only the last', async ({ page }) => {
    // one synth line of steady notes: 8 bars at 88 BPM (the YuE2 example melody)
    await openStudio(page)
    await page.getByRole('button', { name: 'Sheet music' }).click()
    await page.getByRole('dialog', { name: 'Sheet music' }).locator('input[type=file]').setInputFiles('e2e/yue2/melody.abc')
    await page.getByRole('dialog', { name: 'Replace the current song?' }).getByRole('button', { name: 'Replace', exact: true }).click()
    await expect.poll(() => songState(page)).toMatchObject({ name: 'melody', tracks: ['Vocal Melody'], noteCount: 56 })
    // 32 beats at 88 BPM = 21.8 s of notes: every half second of it has sound
    const silentWindows = async (): Promise<number[]> => {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60_000 }),
        page.getByRole('button', { name: 'Export WAV' }).click(),
      ])
      const wav = parseWav(await readFile((await download.path())!))
      return wav.halfSecondPeaks.slice(0, 43).flatMap((p, i) => (p < 0.02 ? [i / 2] : []))
    }
    expect(await silentWindows(), 'mono synth (imported sound)').toEqual([])
    // a poly sound reuses voices as notes end: same check
    await page.locator('.lane').first().locator('.clip').first().click()
    await page.getByRole('button', { name: 'Instrument', exact: true }).click()
    await page.locator('.instrument-presets .preset-name').click()
    await page.locator('.instrument-presets .preset-item', { hasText: /^House Piano$/ }).click()
    expect(await silentWindows(), 'poly synth (House Piano)').toEqual([])
  })

  test('a guide link opens its starter song', async ({ page }) => {
    // read the real link out of a published guide
    await page.goto(TRACKS_URL + '/blog/make-lofi-hip-hop')
    const link = page.locator('a[href*="/studio?template="]').first()
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    expect(href).toMatch(/\/studio\?template=lofi/)
    const want = expectedSong('lofi')

    await link.click()
    await expect(page).toHaveURL(/\/studio/)
    await expect(page.locator('.transport-bar')).toBeVisible()
    await expect.poll(() => songState(page)).toEqual(want)
    // the app drops the query so a reload does not open it again
    await expect(page).not.toHaveURL(/template=/)
  })
})
